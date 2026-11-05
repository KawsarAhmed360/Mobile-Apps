import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import type { SQLInputValue } from 'node:sqlite';
import type { SyncDatabase } from './database.js';
import { z } from 'zod';

type Role = 'owner' | 'staff' | 'customer';
type Reaction = 'like' | 'dislike' | null;
type CommunityRequest = Request & { user?: { id: number; role: Role } };
type Row = Record<string, string | number | null>;

export interface ProductComment {
  id: number;
  productId: number;
  userId: number;
  author: string;
  authorRole: Role;
  body: string;
  likes: number;
  dislikes: number;
  myReaction: Reaction;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityContext {
  db: SyncDatabase;
  transaction?: <T>(fn: () => T) => T;
  auth: RequestHandler;
  optionalAuth: RequestHandler;
  notify: (type: 'catalog' | 'reviews' | 'comments' | 'reactions', productId?: number) => void;
}

class CommunityError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Product discussions are shared by the shop owner and all customers. */
export function mountCommunity(app: Express, { db, auth, optionalAuth, notify, transaction }: CommunityContext): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_comments (
      id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS product_comments_product_order
      ON product_comments(product_id, created_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS comment_reactions (
      comment_id INTEGER NOT NULL REFERENCES product_comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      value INTEGER NOT NULL CHECK(value IN (-1,1)),
      PRIMARY KEY(comment_id,user_id)
    );
  `);

  const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const bodySchema = z.object({ body: z.string().trim().min(1, 'Write a comment first.').max(2000, 'Keep comments within 2,000 characters.') });
  const one = (sql: string, ...parameters: SQLInputValue[]) => db.prepare(sql).get(...parameters) as Row | undefined;
  const all = (sql: string, ...parameters: SQLInputValue[]) => db.prepare(sql).all(...parameters) as Row[];
  const route = (handler: (req: CommunityRequest, res: Response) => void): RequestHandler =>
    (req: CommunityRequest, res: Response, next: NextFunction) => {
      try { handler(req, res); }
      catch (error) {
        if (error instanceof CommunityError) { res.status(error.status).json({ error: error.message }); return; }
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues[0]?.message ?? 'Check the entered details.' }); return; }
        next(error);
      }
    };
  const productExists = (id: number) => {
    if (!one('SELECT id FROM products WHERE id=? AND archived_at IS NULL', id)) throw new CommunityError(404, 'Product is unavailable.');
  };
  const commentExists = (id: number) => {
    const result = one('SELECT id,product_id,user_id FROM product_comments WHERE id=?', id);
    if (!result) throw new CommunityError(404, 'Comment not found.');
    return result;
  };
  const select = `SELECT c.*, u.name author, u.role author_role,
    (SELECT COUNT(*) FROM comment_reactions r WHERE r.comment_id=c.id AND r.value=1) likes,
    (SELECT COUNT(*) FROM comment_reactions r WHERE r.comment_id=c.id AND r.value=-1) dislikes,
    (SELECT value FROM comment_reactions r WHERE r.comment_id=c.id AND r.user_id=?) my_reaction
    FROM product_comments c JOIN users u ON u.id=c.user_id`;
  const toComment = (row: Row): ProductComment => ({
    id: Number(row.id), productId: Number(row.product_id), userId: Number(row.user_id),
    author: String(row.author), authorRole: row.author_role as Role, body: String(row.body),
    likes: Number(row.likes), dislikes: Number(row.dislikes),
    myReaction: row.my_reaction === 1 ? 'like' : row.my_reaction === -1 ? 'dislike' : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  });
  const getComment = (id: number, userId?: number): ProductComment => {
    const row = one(`${select} WHERE c.id=?`, userId ?? 0, id);
    if (!row) throw new CommunityError(404, 'Comment not found.');
    return toComment(row);
  };

  app.get('/api/products/:id/comments', optionalAuth, route((req, res) => {
    const productId = idSchema.parse(req.params.id);
    productExists(productId);
    const { page, limit } = z.object({
      page: z.coerce.number().int().min(1).max(100_000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }).parse(req.query);
    const total = Number(one('SELECT COUNT(*) total FROM product_comments WHERE product_id=?', productId)!.total);
    const items = all(`${select} WHERE c.product_id=? ORDER BY c.created_at DESC,c.id DESC LIMIT ? OFFSET ?`, req.user?.id ?? 0, productId, limit, (page - 1) * limit).map(toComment);
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  }));

  app.post('/api/products/:id/comments', auth, route((req, res) => {
    const productId = idSchema.parse(req.params.id);
    productExists(productId);
    const { body } = bodySchema.parse(req.body);
    const now = new Date().toISOString();
    const result = db.prepare('INSERT INTO product_comments(product_id,user_id,body,created_at,updated_at) VALUES(?,?,?,?,?)').run(productId, req.user!.id, body, now, now);
    const comment = getComment(Number(result.lastInsertRowid), req.user!.id);
    notify('comments', productId);
    res.status(201).json(comment);
  }));

  app.patch('/api/comments/:id', auth, route((req, res) => {
    const id = idSchema.parse(req.params.id);
    const comment = commentExists(id);
    productExists(Number(comment.product_id));
    if (comment.user_id !== req.user!.id) throw new CommunityError(403, 'You can only edit your own comments.');
    const { body } = bodySchema.parse(req.body);
    db.prepare('UPDATE product_comments SET body=?,updated_at=? WHERE id=?').run(body, new Date().toISOString(), id);
    notify('comments', Number(comment.product_id));
    res.json(getComment(id, req.user!.id));
  }));

  app.delete('/api/comments/:id', auth, route((req, res) => {
    const id = idSchema.parse(req.params.id);
    const comment = commentExists(id);
    if (comment.user_id !== req.user!.id && req.user!.role !== 'owner') throw new CommunityError(403, 'You can only delete your own comments.');
    db.prepare('DELETE FROM product_comments WHERE id=?').run(id);
    notify('comments', Number(comment.product_id));
    res.json({ ok: true });
  }));

  app.put('/api/comments/:id/reaction', auth, route((req, res) => {
    const id = idSchema.parse(req.params.id);
    const { value } = z.object({ value: z.enum(['like', 'dislike']).nullable() }).parse(req.body);
    const changeReaction = () => {
      const comment = commentExists(id);
      productExists(Number(comment.product_id));
      if (value === null) db.prepare('DELETE FROM comment_reactions WHERE comment_id=? AND user_id=?').run(id, req.user!.id);
      else db.prepare('INSERT INTO comment_reactions(comment_id,user_id,value) VALUES(?,?,?) ON CONFLICT(comment_id,user_id) DO UPDATE SET value=excluded.value').run(id, req.user!.id, value === 'like' ? 1 : -1);
      return { productId: Number(comment.product_id), result: getComment(id, req.user!.id) };
    };
    const inTransaction = transaction ?? (<T>(fn: () => T) => {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    });
    const { productId, result } = inTransaction(changeReaction);
    notify('reactions', productId);
    res.json(result);
  }));
}
