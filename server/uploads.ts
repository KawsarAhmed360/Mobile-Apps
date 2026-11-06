import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { SyncDatabase } from './database.js';
import multer from 'multer';
import { z } from 'zod';
import { readLocalImage, ServiceError, uploadPublicImage } from './services.js';

type UploadRequest = Request & { user?: { id: number; role: 'owner' | 'staff' | 'customer' } };
type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';
interface UploadContext {
  db: SyncDatabase;
  auth: RequestHandler;
  staff: RequestHandler;
  notify: (type: 'catalog' | 'reviews' | 'comments' | 'reactions', productId?: number) => void;
}

export function detectImageMime(buffer: Buffer): ImageMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const createUploadsTable = (name: 'uploads' | 'uploads_next') => `CREATE TABLE ${name} (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    url TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL CHECK(size>0),
    provider TEXT NOT NULL CHECK(provider IN ('local','firebase','cloudinary')),
    purpose TEXT NOT NULL DEFAULT 'product' CHECK(purpose IN ('product','owner-avatar','profile-avatar','shop-logo')),
    created_at TEXT NOT NULL
  );`;

/** Expand legacy CHECK constraints without changing IDs or child foreign-key targets. */
function ensureUploadSchema(db: SyncDatabase) {
  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='uploads'").get();
  if (!existing) { db.exec(createUploadsTable('uploads')); return; }
  if (String(existing.sql).includes("'local'") && String(existing.sql).includes("'shop-logo'")) return;
  const hasPurpose = db.prepare('PRAGMA table_info(uploads)').all().some(column => column.name === 'purpose');
  const indexesAndTriggers = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='uploads' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
  const previousProblems = new Set(db.prepare('PRAGMA foreign_key_check').all().map(row => JSON.stringify(row)));
  const foreignKeysEnabled = Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) === 1;
  db.exec('PRAGMA foreign_keys=OFF');
  if (Number(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys) !== 0) throw new Error('Photo storage migration must run before opening transactions.');
  let started = false;
  try {
    db.exec('BEGIN IMMEDIATE'); started = true;
    db.exec(createUploadsTable('uploads_next'));
    db.exec(`INSERT INTO uploads_next(id,user_id,url,storage_path,original_name,mime_type,size,provider,purpose,created_at)
      SELECT id,user_id,url,storage_path,original_name,mime_type,size,provider,${hasPurpose ? 'purpose' : "'product'"},created_at FROM uploads`);
    // Never rename the old table: SQLite would rewrite users/products FK targets.
    db.exec('DROP TABLE uploads; ALTER TABLE uploads_next RENAME TO uploads');
    for (const object of indexesAndTriggers) db.exec(String(object.sql));
    const newProblems = db.prepare('PRAGMA foreign_key_check').all().filter(row => !previousProblems.has(JSON.stringify(row)));
    if (newProblems.length) throw new Error('Photo storage migration could not preserve its database references.');
    db.exec('COMMIT'); started = false;
  } catch (error) {
    if (started) db.exec('ROLLBACK');
    throw error;
  } finally { db.exec(`PRAGMA foreign_keys=${foreignKeysEnabled ? 'ON' : 'OFF'}`); }
}

/** Local storage is explicit; remote providers remain optional and report real results. */
export function mountUploads(app: Express, { db, auth }: UploadContext): void {
  ensureUploadSchema(db);

  app.get('/api/media/:id', (req, res, next) => {
    const id = String(req.params.id);
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) { res.status(404).json({ error: 'Photo not found.' }); return; }
    const row = db.prepare("SELECT storage_path,mime_type,size FROM uploads WHERE provider='local' AND url=?").get(`/api/media/${id}`);
    if (!row || !['image/jpeg','image/png','image/webp'].includes(String(row.mime_type))) { res.status(404).json({ error: 'Photo not found.' }); return; }
    try {
      const bytes = readLocalImage(id, String(row.storage_path));
      if (detectImageMime(bytes) !== row.mime_type || bytes.length !== Number(row.size)) throw new ServiceError(404, 'Photo not found.');
      res.setHeader('Content-Type', String(row.mime_type));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'public,max-age=31536000,immutable');
      res.send(bytes);
    } catch (error) {
      if (error instanceof ServiceError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    }
  });
  const parseFile = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, fieldSize: 1000, parts: 3 },
  }).single('file');
  const parse: RequestHandler = (req, res, next) => parseFile(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'Choose an image smaller than 5 MB.' : 'Send one image using the file field.' });
      return;
    }
    if (error) { res.status(400).json({ error: 'The upload could not be read. Choose a valid image file.' }); return; }
    next();
  });

  app.post('/api/uploads', auth, parse, async (req: UploadRequest, res: Response, next: NextFunction) => {
    try {
      const purpose = z.enum(['product', 'owner-avatar', 'profile-avatar', 'shop-logo']).default('product').parse(req.body?.purpose);
      if (purpose === 'product' && req.user!.role !== 'owner' && req.user!.role !== 'staff') throw new ServiceError(403, 'Only shop staff can upload product photos.');
      if (purpose === 'owner-avatar' && req.user!.role !== 'owner') throw new ServiceError(403, 'Only the shop owner can upload an owner profile photo.');
      if (purpose === 'shop-logo' && req.user!.role !== 'owner') throw new ServiceError(403, 'Only the shop owner can upload a shop logo.');
      const file = req.file;
      if (!file || file.size === 0) throw new ServiceError(400, 'Choose an image first.');
      const mimeType = detectImageMime(file.buffer);
      if (!mimeType) throw new ServiceError(400, 'Upload a JPEG, PNG or WebP image. SVG, HTML and document files are not accepted.');
      const declared = file.mimetype.toLowerCase();
      if (declared && declared !== 'application/octet-stream' && declared !== mimeType) throw new ServiceError(400, 'The file contents do not match its image type.');
      const name = file.originalname.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || purpose;
      const stored = await uploadPublicImage({ buffer: file.buffer, mimeType, userId: req.user!.id, name, purpose });
      const result = db.prepare('INSERT INTO uploads(user_id,url,storage_path,original_name,mime_type,size,provider,purpose,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(req.user!.id, stored.url, stored.storagePath, name, mimeType, file.size, stored.provider, purpose, new Date().toISOString());
      res.status(201).json({ id: Number(result.lastInsertRowid), url: stored.url, name, mimeType, size: file.size, storage: stored.provider, purpose });
    } catch (error) {
      if (error instanceof ServiceError) { res.status(error.status).json({ error: error.message }); return; }
      if (error instanceof z.ZodError) { res.status(400).json({ error: 'Only product images, profile photos and shop logos are supported.' }); return; }
      next(error);
    }
  });
}
