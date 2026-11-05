import express, { type NextFunction, type Request, type Response } from 'express';
import type { SyncDatabase } from './database.js';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { mountCommunity } from './community.js';
import { getServiceConfig, ServiceError, verifyFirebaseIdToken } from './services.js';
import { mountUploads } from './uploads.js';
import { verifySignupContact } from './signup-verification.js';

type Row = Record<string, any>;
type Role = 'owner' | 'staff' | 'customer';
type AuthRequest = Request & { user?: { id: number; role: Role; sessionId?: string } };
export type CoreOptions = { db: SyncDatabase; transaction?: <T>(fn: () => T) => T; seed?: boolean; secret: string; demo?: boolean; ownerSetupCode: string; cloud?: boolean; verifyIdentity?: typeof verifyFirebaseIdToken };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const integer = z.number().int().min(0).max(100_000_000);
const quantity = z.number().int().min(1).max(100_000);
const requestId = z.string().min(8).max(120);
const paymentMethod = z.enum(['cash', 'bkash', 'nagad', 'bank', 'other']);
const businessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, 'Enter a valid calendar date.');
const iconSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const productIcon = z.string().trim().refine(value => {
  if (!value || Array.from(value).length > 32) return false;
  return Array.from(iconSegmenter.segment(value)).length === 1;
}, 'Choose one product icon.');
const productInput = z.object({
  name: z.string().trim().min(2).max(120), category: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(30), price: integer, cost: integer,
  stock: z.number().int().min(0).max(100_000), reorderLevel: z.number().int().min(0).max(100_000),
  description: z.string().trim().max(2000).default(''), emoji: productIcon.default('📦'),
  uploadId: z.number().int().positive().optional(), imageUrl: z.string().max(2048).optional(),
});

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

function verifyPassword(password: string, encoded: string) {
  const [salt, digest] = encoded.split(':');
  if (!salt || !digest) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(digest, 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

export function dhakaDate(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function safeMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) throw new ApiError(400, 'The transaction amount is too large.');
  return value;
}

export function createApp(options: CoreOptions) {
  const db = options.db;
  const verifyIdentity = options.verifyIdentity ?? verifyFirebaseIdToken;
  const demo = options.demo ?? true;
  if (options.cloud && (demo || options.secret.length < 32 || options.ownerSetupCode.length < 12 || !options.transaction)) throw new Error('Cloud mode requires private credentials, durable transactions and demo mode disabled.');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','staff','customer')), created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shop (
      id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, tagline TEXT NOT NULL,
      address TEXT NOT NULL, phone TEXT NOT NULL, opening_hours TEXT NOT NULL,
      latitude REAL NOT NULL, longitude REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, unit TEXT NOT NULL,
      price INTEGER NOT NULL CHECK(price>=0), cost INTEGER NOT NULL CHECK(cost>=0),
      stock INTEGER NOT NULL CHECK(stock>=0), reorder_level INTEGER NOT NULL CHECK(reorder_level>=0),
      description TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), total INTEGER NOT NULL,
      paid INTEGER NOT NULL, cost INTEGER NOT NULL, created_at TEXT NOT NULL, business_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL, unit_price INTEGER NOT NULL, unit_cost INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL,
      unit_cost INTEGER NOT NULL, reference TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, amount INTEGER NOT NULL, business_date TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL,
      type TEXT NOT NULL, reference_id INTEGER, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), user_id INTEGER NOT NULL REFERENCES users(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), body TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE(product_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requests (
      kind TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL,
      PRIMARY KEY(kind,request_id)
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE TABLE IF NOT EXISTS uploads (
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      url TEXT NOT NULL, storage_path TEXT NOT NULL, original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL, size INTEGER NOT NULL, provider TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_receipts (
      id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
      user_id INTEGER NOT NULL REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount>0),
      opening_amount INTEGER NOT NULL DEFAULT 0 CHECK(opening_amount>=0 AND opening_amount<=amount),
      method TEXT NOT NULL CHECK(method IN ('cash','bkash','nagad','bank','other')),
      note TEXT NOT NULL DEFAULT '', business_date TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS receipt_allocations (
      receipt_id INTEGER NOT NULL REFERENCES customer_receipts(id) ON DELETE CASCADE,
      sale_id INTEGER NOT NULL REFERENCES sales(id), amount INTEGER NOT NULL CHECK(amount>0),
      PRIMARY KEY(receipt_id,sale_id)
    );
    CREATE INDEX IF NOT EXISTS receipt_allocations_sale ON receipt_allocations(sale_id);
    CREATE TABLE IF NOT EXISTS stock_alert_reads (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      stock_at_read INTEGER NOT NULL, reorder_at_read INTEGER NOT NULL, read_at TEXT NOT NULL,
      PRIMARY KEY(user_id,product_id)
    );
  `);

  // Non-destructive migrations keep the existing shop records intact.
  const addColumn = (table: string, name: string, declaration: string) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];
    if (!columns.some(column => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`);
  };
  for (const [name, declaration] of [
    ['phone', "TEXT NOT NULL DEFAULT ''"], ['email_verified', 'INTEGER NOT NULL DEFAULT 0'],
    ['phone_verified', 'INTEGER NOT NULL DEFAULT 0'], ['firebase_uid', 'TEXT'],
    ['is_demo', 'INTEGER NOT NULL DEFAULT 0'], ['disabled', 'INTEGER NOT NULL DEFAULT 0'],
  ]) addColumn('users', name, declaration);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique ON users(firebase_uid)');
  addColumn('products', 'image_url', 'TEXT');
  addColumn('products', 'upload_id', 'INTEGER REFERENCES uploads(id)');
  addColumn('products', 'archived_at', 'TEXT');
  addColumn('users', 'avatar_url', "TEXT NOT NULL DEFAULT ''");
  addColumn('users', 'avatar_upload_id', 'INTEGER REFERENCES uploads(id)');
  addColumn('users', 'address', "TEXT NOT NULL DEFAULT ''");
  addColumn('customers', 'user_id', 'INTEGER REFERENCES users(id)');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS customers_user_unique ON customers(user_id) WHERE user_id IS NOT NULL');
  addColumn('shop', 'email', "TEXT NOT NULL DEFAULT 'demo@smartshop.local'");
  addColumn('shop', 'configured', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('shop', 'map_location_set', 'INTEGER NOT NULL DEFAULT 1');
  addColumn('customers', 'opening_due', 'INTEGER NOT NULL DEFAULT 0 CHECK(opening_due>=0)');
  addColumn('customer_receipts', 'opening_amount', 'INTEGER NOT NULL DEFAULT 0 CHECK(opening_amount>=0)');
  addColumn('user_sessions', 'refresh_token_hash', 'TEXT');
  addColumn('user_sessions', 'previous_refresh_token_hash', 'TEXT');
  addColumn('user_sessions', 'previous_refresh_valid_until', 'TEXT');
  addColumn('user_sessions', 'refresh_rotated_at', 'TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_refresh_hash_unique ON user_sessions(refresh_token_hash) WHERE refresh_token_hash IS NOT NULL');

  const now = () => new Date().toISOString();
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as Row[];
  const run = (sql: string, ...args: any[]) => db.prepare(sql).run(...args);
  const transaction = <T>(fn: () => T): T => {
    if (options.transaction) return options.transaction(fn);
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const recordActivity = (type: string, title: string, detail: string, amount = 0) =>
    run('INSERT INTO activity(type,title,detail,amount,created_at) VALUES(?,?,?,?,?)', type, title, detail, amount, now());

  if (options.seed !== false && !one('SELECT id FROM shop WHERE id=1')) {
    transaction(() => {
      run('INSERT INTO shop(id,name,tagline,address,phone,opening_hours,latitude,longitude) VALUES(1,?,?,?,?,?,?,?)', 'SmartShop', 'Your everyday essentials, thoughtfully stocked.', 'Demo shop location, Dhaka, Bangladesh', '+880 1700-000000', 'Every day · 9:00 AM – 10:00 PM', 23.8103, 90.4125);
      if (demo) {
        run('INSERT INTO users(name,username,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', 'Shop Owner', 'owner', 'owner@smartshop.local', hashPassword('SmartShop@123'), 'owner', now());
        run('INSERT INTO users(name,username,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', 'Demo Customer', 'customer', 'customer@smartshop.local', hashPassword('Customer@123'), 'customer', now());
      }
      const products = [
        ['Miniket Rice', 'Groceries', 'kg', 7800, 6400, 48, 10, 'Premium everyday rice, perfect for family meals.', '🍚'],
        ['Fresh Milk', 'Dairy', 'litre', 9500, 7800, 6, 8, 'Fresh and creamy milk for your everyday routine.', '🥛'],
        ['Farm Eggs', 'Dairy', 'dozen', 15500, 13000, 18, 5, 'A dozen fresh farm eggs, carefully selected.', '🥚'],
        ['Soybean Oil', 'Groceries', 'litre', 17500, 15100, 24, 6, 'Quality cooking oil for all your favourite dishes.', '🫙'],
        ['Red Apples', 'Produce', 'kg', 29000, 24000, 4, 5, 'Crisp, sweet red apples sold by the kilogram.', '🍎'],
        ['Potato Chips', 'Snacks', 'pack', 4000, 3000, 32, 10, 'Crispy salted potato chips for a quick snack.', '🍿'],
        ['Bath Soap', 'Personal care', 'piece', 6500, 4800, 20, 5, 'A gentle cleansing soap for everyday use.', '🧼'],
        ['Green Tea', 'Beverages', 'box', 18000, 14000, 0, 4, 'A refreshing box of green tea bags.', '🍵'],
        ['Whole Wheat Bread', 'Bakery', 'loaf', 9000, 6800, 9, 4, 'Soft whole wheat bread, ideal for breakfast.', '🍞'],
        ['Orange Juice', 'Beverages', 'bottle', 12000, 9200, 15, 5, 'Refreshing orange juice for any time of day.', '🍊'],
      ];
      for (const p of products) {
        const result = run('INSERT INTO products(name,category,unit,price,cost,stock,reorder_level,description,emoji,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', ...p, now());
        run('INSERT INTO stock_movements(product_id,quantity,type,created_at) VALUES(?,?,?,?)', Number(result.lastInsertRowid), p[5], 'opening', now());
      }
      if (demo) {
        const customer = run('INSERT INTO customers(name,phone,created_at) VALUES(?,?,?)', 'Ayesha Rahman', '01700-000001', now());
        const sale = run('INSERT INTO sales(customer_id,total,paid,cost,created_at,business_date) VALUES(?,?,?,?,?,?)', Number(customer.lastInsertRowid), 19600, 15000, 15800, now(), dhakaDate());
        const saleId = Number(sale.lastInsertRowid);
        run('INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost) VALUES(?,?,?,?,?)', saleId, 1, 2, 7800, 6400);
        run('INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost) VALUES(?,?,?,?,?)', saleId, 6, 1, 4000, 3000);
        run('UPDATE products SET stock=stock-2 WHERE id=1');
        run('UPDATE products SET stock=stock-1 WHERE id=6');
        run('INSERT INTO stock_movements(product_id,quantity,type,reference_id,created_at) VALUES(?,?,?,?,?)', 1, -2, 'sale', saleId, now());
        run('INSERT INTO stock_movements(product_id,quantity,type,reference_id,created_at) VALUES(?,?,?,?,?)', 6, -1, 'sale', saleId, now());
        run('INSERT INTO expenses(title,amount,business_date,created_at) VALUES(?,?,?,?)', 'Demo: shop supplies', 1500, dhakaDate(), now());
        recordActivity('sale', 'Sale #1', 'Ayesha Rahman · sample transaction', 19600);
        recordActivity('expense', 'Shop supplies', 'Sample expense', 1500);
        run('INSERT INTO reviews(product_id,user_id,rating,body,created_at) VALUES(?,?,?,?,?)', 1, 2, 5, 'Sample review: great quality rice for everyday meals.', now());
      }
    });
  }

  run("UPDATE users SET is_demo=1 WHERE email IN ('owner@smartshop.local','customer@smartshop.local')");
  if (options.cloud) run('UPDATE users SET disabled=1 WHERE is_demo=1');
  if (!one('SELECT id FROM shop WHERE id=1')) run("INSERT INTO shop(id,name,tagline,address,phone,opening_hours,latitude,longitude,email,configured,map_location_set) VALUES(1,'SmartShop','','','','',0,0,'',0,0)");
  // Link registered customers to their ledger without changing any existing balances.
  const ensureCustomerContact = (user: Row) => {
    if (one('SELECT id FROM customers WHERE user_id=?', user.id)) return;
    const matches = all("SELECT id FROM customers WHERE user_id IS NULL AND email<>'' AND email=? COLLATE NOCASE", user.email);
    if (matches.length === 1) run('UPDATE customers SET user_id=? WHERE id=?', user.id, matches[0].id);
    else if (!matches.length) run('INSERT INTO customers(name,phone,email,address,user_id,created_at) VALUES(?,?,?,?,?,?)', user.name, user.phone || '', user.email, user.address || '', user.id, now());
  };
  for (const registered of all("SELECT * FROM users WHERE role='customer' AND is_demo=0 AND disabled=0")) ensureCustomerContact(registered);
  const needsOwner = () => !one("SELECT id FROM users WHERE role='owner' AND is_demo=0 AND disabled=0");
  const ownerSetupCode = options.ownerSetupCode;
  const jwtSecret = options.secret;
  const app = express();
  app.disable('x-powered-by');
  const allowedOrigins = new Set(['http://localhost','https://localhost','capacitor://localhost',...(process.env.APP_ALLOWED_ORIGINS ?? '').split(',').map(value=>value.trim()).filter(Boolean)]);
  app.use((req,res,next)=>{
    const origin=req.headers.origin;
    if(origin && allowedOrigins.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin',origin); res.setHeader('Vary','Origin');
      res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, PUT, DELETE, OPTIONS');
    }
    if(req.method==='OPTIONS'){res.status(204).end();return;}
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); next(); });

  const auth = (req: AuthRequest, _res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return next(new ApiError(401, 'Please sign in to continue.'));
    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      const user = one('SELECT id,role FROM users WHERE id=? AND disabled=0', Number(payload.sub));
      const session = typeof payload.sid === 'string' ? one('SELECT id FROM user_sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>?', payload.sid, Number(payload.sub), now()) : undefined;
      if (!user || !session) throw new Error('Missing user or inactive session');
      req.user = { id: user.id, role: user.role, sessionId: payload.sid as string };
      next();
    } catch { next(new ApiError(401, 'Your session has expired. Please sign in again.')); }
  };
  const optionalAuth = (req: Request, res: Response, next: NextFunction) => req.headers.authorization ? auth(req, res, next) : next();
  const staff = (req: AuthRequest, _res: Response, next: NextFunction) => req.user?.role === 'owner' || req.user?.role === 'staff' ? next() : next(new ApiError(403, 'This action requires shop staff access.'));
  const ownerOnly = (req: AuthRequest, _res: Response, next: NextFunction) => req.user?.role === 'owner' ? next() : next(new ApiError(403, 'This action requires the shop owner.'));
  const publicUser = (user: Row) => ({ id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, phone: user.phone, address: user.address || '', emailVerified: !!user.email_verified, phoneVerified: !!user.phone_verified, firebaseLinked: !!user.firebase_uid, isDemo: !!user.is_demo, avatarUrl: user.avatar_url || null, avatarUploadId: user.avatar_upload_id ?? null });
  const accessToken = (user: Row, sessionId: string) => jwt.sign({ sid: sessionId }, jwtSecret, { subject: String(user.id), expiresIn: '1d', algorithm: 'HS256' });
  const refreshSchema = z.string().regex(/^[a-f0-9]{48}\.[A-Za-z0-9_-]{43}$/, 'Your saved sign-in is invalid. Please sign in again.');
  const refreshHash = (token: string) => createHash('sha256').update(token).digest('hex');
  const equalHash = (actual: unknown, expected: string) => typeof actual === 'string' && actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  const successorRefresh = (token: string) => `${token.split('.')[0]}.${createHmac('sha256', jwtSecret).update(`smartshop-refresh:${token}`).digest('base64url')}`;
  const authResult = (user: Row) => {
    const id = randomBytes(24).toString('hex');
    const refreshToken = `${id}.${randomBytes(32).toString('base64url')}`;
    run('INSERT INTO user_sessions(id,user_id,created_at,expires_at,refresh_token_hash) VALUES(?,?,?,?,?)', id, user.id, now(), '9999-12-31T23:59:59.999Z', refreshHash(refreshToken));
    return { token: accessToken(user, id), refreshToken, user: publicUser(user) };
  };
  const product = (row: Row, privateFields = false) => ({
    id: row.id, name: row.name, category: row.category, unit: row.unit, price: row.price,
    description: row.description, emoji: row.emoji, inStock: row.stock > 0,
    averageRating: Number(row.rating ?? 0), reviewCount: Number(row.review_count ?? 0),
    imageUrl: row.image_url ?? null, uploadId: row.upload_id ?? null,
    ...(privateFields ? { cost: row.cost, stock: row.stock, reorderLevel: row.reorder_level } : {}),
  });
  const productSql = 'SELECT p.*, COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id=p.id),0) rating, (SELECT COUNT(*) FROM reviews WHERE product_id=p.id) review_count FROM products p';
  const getProduct = (id: number) => {
    const row = one(`${productSql} WHERE p.id=? AND p.archived_at IS NULL`, id);
    if (!row) throw new ApiError(404, 'Product is unavailable.');
    return row;
  };
  const getProductPhoto = (uploadId: number, userId: number) => {
    const asset = one("SELECT * FROM uploads WHERE id=? AND user_id=? AND purpose='product'", uploadId, userId);
    if (!asset) throw new ApiError(400, 'Choose a product photo uploaded by your account.');
    return asset;
  };
  const clients = new Set<Response>();
  const notify = (type: 'catalog' | 'reviews' | 'comments' | 'reactions' | 'shop' | 'payments' | 'alerts' | 'staff', productId?: number) => {
    const body = `event: change\ndata: ${JSON.stringify({ type, ...(productId ? { productId } : {}) })}\n\n`;
    for (const client of clients) client.write(body);
  };
  const cachedRequest = <T>(kind: string, key: string, payload: unknown, fn: () => T): T => {
    const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return transaction(() => {
      const existing = one('SELECT * FROM requests WHERE kind=? AND request_id=?', kind, key);
      if (existing) {
        if (existing.digest !== digest) throw new ApiError(409, 'This request ID was already used for different details.');
        return JSON.parse(existing.response) as T;
      }
      const result = fn();
      run('INSERT INTO requests(kind,request_id,digest,response) VALUES(?,?,?,?)', kind, key, digest, JSON.stringify(result));
      return result;
    });
  };

  const shopProfile = (row: Row) => ({
    name: row.name, tagline: row.tagline, address: row.address, phone: row.phone,
    email: row.email, openingHours: row.opening_hours,
    latitude: row.map_location_set ? row.latitude : null, longitude: row.map_location_set ? row.longitude : null,
    currency: 'BDT', demo: !row.configured,
  });
  const customerSql = `SELECT c.*, (SELECT u.avatar_url FROM users u WHERE u.id=c.user_id) avatar_url, COALESCE(SUM(s.total),0) total_spent, COUNT(s.id) orders,
    COALESCE((SELECT SUM(r.opening_amount) FROM customer_receipts r WHERE r.customer_id=c.id),0) opening_settled,
    c.opening_due-COALESCE((SELECT SUM(r.opening_amount) FROM customer_receipts r WHERE r.customer_id=c.id),0)
      +COALESCE(SUM(s.total-s.paid-COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a.sale_id=s.id),0)),0) due
    FROM customers c LEFT JOIN sales s ON s.customer_id=c.id`;
  const customerProfile = (row: Row) => ({
    id: row.id, name: row.name, phone: row.phone, email: row.email, address: row.address,
    totalSpent: row.total_spent, due: row.due, purchases: row.orders,
    openingDue: row.opening_due, openingSettled: row.opening_settled,
    userId: row.user_id ?? null, avatarUrl: row.avatar_url || null,
  });
  const getCustomer = (id: number) => {
    const customer = one(`${customerSql} WHERE c.id=? GROUP BY c.id`, id);
    if (!customer) throw new ApiError(404, 'Customer not found.');
    return customer;
  };
  // Called inside the enclosing idempotent transaction. Original sale payments remain immutable.
  const recordReceipt = (customerId: number, userId: number, amount: number, method: z.infer<typeof paymentMethod>, note: string, date: string) => {
    const customer = getCustomer(customerId);
    if (amount <= 0 || amount > customer.due) throw new ApiError(400, 'Payment must be greater than zero and cannot exceed the customer balance due.');
    const openingAmount = Math.min(amount, Math.max(0, customer.opening_due - customer.opening_settled));
    const receipt = run('INSERT INTO customer_receipts(customer_id,user_id,amount,opening_amount,method,note,business_date,created_at) VALUES(?,?,?,?,?,?,?,?)', customerId, userId, amount, openingAmount, method, note, date, now());
    const id = Number(receipt.lastInsertRowid);
    let remaining = amount - openingAmount;
    const unpaidSales = all(`SELECT s.id,s.total-s.paid-COALESCE(SUM(a.amount),0) due
      FROM sales s LEFT JOIN receipt_allocations a ON a.sale_id=s.id
      WHERE s.customer_id=? GROUP BY s.id HAVING due>0 ORDER BY s.created_at,s.id`, customerId);
    for (const sale of unpaidSales) {
      if (remaining === 0) break;
      const allocated = Math.min(remaining, sale.due);
      run('INSERT INTO receipt_allocations(receipt_id,sale_id,amount) VALUES(?,?,?)', id, sale.id, allocated);
      remaining -= allocated;
    }
    if (remaining !== 0) throw new ApiError(409, 'The customer balance changed. Reload the ledger and try again.');
    recordActivity('payment', `Payment from ${customer.name}`, `${method} · customer balance collection`, amount);
    return { id, amount, remainingDue: customer.due - amount };
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true, demo: demo && needsOwner(), verificationConfigured: getServiceConfig().verification.email }));
  app.get('/api/config', (_req, res) => res.json({ demo: demo && needsOwner(), ownerSetupRequired: needsOwner(), ...getServiceConfig() }));
  app.get('/api/auth/me', auth, (req: AuthRequest, res) => res.json(publicUser(one('SELECT * FROM users WHERE id=?', req.user!.id)!)));
  app.post('/api/auth/refresh', (req, res) => {
    const parsed = z.object({ refreshToken: refreshSchema }).safeParse(req.body);
    if (!parsed.success) throw new ApiError(401, 'Your saved sign-in is invalid. Please sign in again.');
    const supplied = parsed.data.refreshToken;
    const id = supplied.split('.')[0];
    const result = transaction(() => {
      const session = one('SELECT * FROM user_sessions WHERE id=? AND revoked_at IS NULL AND expires_at>?', id, now());
      const user = session ? one('SELECT * FROM users WHERE id=? AND disabled=0', session.user_id) : undefined;
      if (!session || !user || !session.refresh_token_hash) throw new ApiError(401, 'Your saved sign-in is no longer active. Please sign in again.');
      const digest = refreshHash(supplied);
      let refreshToken: string;
      if (equalHash(session.refresh_token_hash, digest)) {
        // Reuse the current token during the grace window so parallel tabs converge.
        const recentRotation = typeof session.refresh_rotated_at === 'string' && Date.parse(session.refresh_rotated_at) + 30_000 > Date.now();
        refreshToken = recentRotation ? supplied : successorRefresh(supplied);
        if (!recentRotation) run('UPDATE user_sessions SET previous_refresh_token_hash=refresh_token_hash,previous_refresh_valid_until=?,refresh_token_hash=?,refresh_rotated_at=? WHERE id=?', new Date(Date.now() + 30_000).toISOString(), refreshHash(refreshToken), now(), id);
      } else if (equalHash(session.previous_refresh_token_hash, digest) && session.previous_refresh_valid_until > now()) {
        // The deterministic successor lets retries return the same secret without storing it.
        refreshToken = successorRefresh(supplied);
        if (!equalHash(session.refresh_token_hash, refreshHash(refreshToken))) throw new ApiError(401, 'Your saved sign-in changed. Please sign in again.');
      } else throw new ApiError(401, 'Your saved sign-in is no longer active. Please sign in again.');
      return { token: accessToken(user, id), refreshToken, user: publicUser(user) };
    });
    res.json(result);
  });
  app.get('/api/staff/users', auth, ownerOnly, (req, res) => {
    const { search, page, limit } = z.object({ search: z.string().trim().max(100).default(''), page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
    const escaped = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const where = " WHERE disabled=0 AND is_demo=0 AND (name LIKE ? ESCAPE '\\' OR username LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')";
    const parameters = [escaped, escaped, escaped, escaped];
    const total = one(`SELECT COUNT(*) n FROM users${where}`, ...parameters)!.n;
    const items = all(`SELECT * FROM users${where} ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END,name,id LIMIT ? OFFSET ?`, ...parameters, limit, (page - 1) * limit).map(publicUser);
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });
  app.patch('/api/staff/users/:id', auth, ownerOnly, (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = z.object({ role: z.enum(['staff', 'customer']) }).strict().parse(req.body);
    const user = transaction(() => {
      const target = one('SELECT * FROM users WHERE id=?', id);
      if (!target) throw new ApiError(404, 'Account not found.');
      if (target.role === 'owner') throw new ApiError(403, 'The shop owner account cannot be changed through staff permissions.');
      if (target.disabled || target.is_demo) throw new ApiError(400, 'Choose an active registered account. Demo and disabled accounts cannot receive staff access.');
      run('UPDATE users SET role=? WHERE id=?', body.role, id);
      return publicUser(one('SELECT * FROM users WHERE id=?', id)!);
    });
    notify('staff');
    res.json(user);
  });
  const updateOwnProfile = (req: AuthRequest, res: Response) => {
    const body = z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().max(30).optional(), address: z.string().trim().max(300).optional(), avatarUploadId: z.number().int().positive().nullable().optional() }).strict().refine(value => Object.keys(value).length > 0, 'Enter a profile detail to update.').parse(req.body);
    const current = one('SELECT * FROM users WHERE id=?', req.user!.id)!;
    let avatarUrl = current.avatar_url, avatarId = current.avatar_upload_id;
    if (body.avatarUploadId !== undefined) {
      const image = body.avatarUploadId === null ? null : one("SELECT * FROM uploads WHERE id=? AND user_id=? AND purpose IN ('owner-avatar','profile-avatar')", body.avatarUploadId, req.user!.id);
      if (body.avatarUploadId !== null && !image) throw new ApiError(400, 'Choose a profile photo uploaded by your own account.');
      avatarUrl = image?.url ?? ''; avatarId = image?.id ?? null;
    }
    const phone = body.phone ?? current.phone;
    transaction(() => {
      run('UPDATE users SET name=?,phone_verified=CASE WHEN phone=? THEN phone_verified ELSE 0 END,phone=?,address=?,avatar_url=?,avatar_upload_id=? WHERE id=?', body.name ?? current.name, phone, phone, body.address ?? current.address, avatarUrl, avatarId, req.user!.id);
      run('UPDATE customers SET name=?,phone=?,address=? WHERE user_id=?', body.name ?? current.name, phone, body.address ?? current.address, req.user!.id);
    });
    notify('shop');
    res.json(publicUser(one('SELECT * FROM users WHERE id=?', req.user!.id)!));
  };
  app.patch('/api/owner/profile', auth, ownerOnly, updateOwnProfile);
  app.patch('/api/auth/profile', auth, updateOwnProfile);
  app.get('/api/settings', auth, ownerOnly, (req: AuthRequest, res) => {
    const owner = one('SELECT name,email,phone,avatar_url,avatar_upload_id FROM users WHERE id=?', req.user!.id)!;
    const shop = one('SELECT * FROM shop WHERE id=1');
    if (!shop) throw new ApiError(404, 'Shop not configured.');
    res.json({ owner: { name: owner.name, email: owner.email, phone: owner.phone, avatarUrl: owner.avatar_url || null, avatarUploadId: owner.avatar_upload_id ?? null }, shop: shopProfile(shop) });
  });
  app.put('/api/shop', auth, ownerOnly, (req, res) => {
    const body = z.object({
      name: z.string().trim().min(2).max(120), tagline: z.string().trim().max(240),
      phone: z.string().trim().max(30), email: z.union([z.literal(''), z.string().trim().email().max(254)]),
      address: z.string().trim().min(2).max(500), openingHours: z.string().trim().max(150),
      latitude: z.number().min(-90).max(90).nullable(), longitude: z.number().min(-180).max(180).nullable(),
    }).refine(value => (value.latitude === null) === (value.longitude === null), { message: 'Enter both map coordinates or leave both empty.' }).parse(req.body);
    const current = one('SELECT * FROM shop WHERE id=1');
    if (!current) throw new ApiError(404, 'Shop not configured.');
    run('UPDATE shop SET name=?,tagline=?,phone=?,email=?,address=?,opening_hours=?,latitude=?,longitude=?,map_location_set=?,configured=1 WHERE id=1', body.name, body.tagline, body.phone, body.email, body.address, body.openingHours, body.latitude ?? current.latitude, body.longitude ?? current.longitude, body.latitude === null ? 0 : 1);
    notify('shop');
    res.json(shopProfile(one('SELECT * FROM shop WHERE id=1')!));
  });
  app.post('/api/auth/logout', (req, res) => {
    let sessionId: string | undefined;
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (token) {
      try {
        const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'], ignoreExpiration: true }) as jwt.JwtPayload;
        if (typeof payload.sid === 'string' && one('SELECT id FROM user_sessions WHERE id=? AND user_id=?', payload.sid, Number(payload.sub))) sessionId = payload.sid;
      } catch { /* A valid saved refresh token can still complete an explicit logout. */ }
    }
    if (!sessionId) {
      const parsed = refreshSchema.safeParse(req.body?.refreshToken);
      if (parsed.success) {
        const supplied = parsed.data;
        const session = one('SELECT * FROM user_sessions WHERE id=?', supplied.split('.')[0]);
        const digest = refreshHash(supplied);
        if (session && (equalHash(session.refresh_token_hash, digest) || equalHash(session.previous_refresh_token_hash, digest) && session.previous_refresh_valid_until > now())) sessionId = session.id;
      }
    }
    if (!sessionId) throw new ApiError(401, 'No active sign-in was supplied.');
    run('UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?', now(), sessionId);
    res.json({ ok: true });
  });
  const loginAttempts = new Map<string, { count: number; expires: number }>();
  app.post('/api/auth/login', (req, res) => {
    const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).parse(req.body);
    const key = `${req.ip}:${body.email.toLowerCase()}`;
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.expires > Date.now() && attempt.count >= 10) throw new ApiError(429, 'Too many attempts. Please try again in a few minutes.');
    const user = one('SELECT * FROM users WHERE email=? COLLATE NOCASE AND disabled=0', body.email.trim());
    if (!user || !verifyPassword(body.password, user.password_hash)) {
      const current = attempt && attempt.expires > Date.now() ? attempt : { count: 0, expires: Date.now() + 300_000 };
      current.count++; loginAttempts.set(key, current);
      throw new ApiError(401, 'Email or password is incorrect.');
    }
    loginAttempts.delete(key);
    res.json(authResult(user));
  });
  const usernameSchema = z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, 'Use 3–24 letters, numbers or underscores.');
  app.get('/api/auth/username', (req, res) => {
    const username = usernameSchema.parse(req.query.username);
    res.json({ available: !one('SELECT id FROM users WHERE username=? COLLATE NOCASE', username) });
  });
  const signupFields = z.object({
    name: z.string().trim().min(2).max(80), username: usernameSchema, email: z.string().trim().email().max(254),
    password: z.string().min(8).max(128), phone: z.string().trim().max(30).default(''),
    idToken: z.string().min(50).max(15000).optional(),
  });
  const ensureSignupAvailable = (body: { username: string; email: string }, uid: string | null = null) => {
    if (one('SELECT id FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE OR firebase_uid=?', body.username, body.email, uid)) {
      throw new ApiError(409, 'That username or email is already registered. Sign in if it is yours.');
    }
  };
  app.post('/api/auth/register', async (req, res) => {
    const body = signupFields.parse(req.body);
    ensureSignupAvailable(body);
    const verified = await verifySignupContact(body, getServiceConfig().verification, verifyIdentity);
    const result = transaction(() => {
      ensureSignupAvailable(body, verified.uid);
      const inserted = run('INSERT INTO users(name,username,email,password_hash,role,phone,firebase_uid,email_verified,phone_verified,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', body.name, body.username, body.email.toLowerCase(), hashPassword(body.password), 'customer', verified.phone, verified.uid, verified.emailVerified, verified.phoneVerified, now());
      const user = one('SELECT * FROM users WHERE id=?', Number(inserted.lastInsertRowid))!;
      ensureCustomerContact(user);
      return authResult(user);
    });
    res.status(201).json(result);
  });
  const setupAttempts = new Map<string, { count: number; expires: number }>();
  app.post('/api/setup/owner', async (req, res) => {
    if (!needsOwner()) throw new ApiError(409, 'The shop owner account is already configured.');
    const key = req.ip ?? 'unknown';
    const attempt = setupAttempts.get(key);
    if (attempt && attempt.expires > Date.now() && attempt.count >= 5) throw new ApiError(429, 'Too many setup attempts. Try again in 15 minutes.');
    const body = signupFields.extend({ password: z.string().min(10).max(128), setupCode: z.string().min(1).max(128) }).parse(req.body);
    const given = createHash('sha256').update(body.setupCode.trim()).digest();
    const expected = createHash('sha256').update(ownerSetupCode!).digest();
    if (!timingSafeEqual(given, expected)) {
      const current = attempt && attempt.expires > Date.now() ? attempt : { count: 0, expires: Date.now() + 900_000 };
      current.count++; setupAttempts.set(key, current);
      throw new ApiError(403, 'The owner activation code is incorrect. Use the code on your Mac.');
    }
    ensureSignupAvailable(body);
    const verified = await verifySignupContact(body, getServiceConfig().verification, verifyIdentity);
    const owner = transaction(() => {
      if (!needsOwner()) throw new ApiError(409, 'The shop owner account is already configured.');
      ensureSignupAvailable(body, verified.uid);
      const result = run("INSERT INTO users(name,username,email,password_hash,role,phone,firebase_uid,email_verified,phone_verified,created_at) VALUES(?,?,?,?,'owner',?,?,?,?,?)", body.name, body.username, body.email.toLowerCase(), hashPassword(body.password), verified.phone, verified.uid, verified.emailVerified, verified.phoneVerified, now());
      run('UPDATE users SET disabled=1 WHERE is_demo=1');
      run('UPDATE user_sessions SET revoked_at=? WHERE user_id IN (SELECT id FROM users WHERE is_demo=1)', now());
      return one('SELECT * FROM users WHERE id=?', Number(result.lastInsertRowid))!;
    });
    setupAttempts.delete(key);
    res.status(201).json(authResult(owner));
  });
  app.post('/api/setup/owner/claim', auth, (req: AuthRequest, res) => {
    if (!needsOwner()) throw new ApiError(409, 'The shop owner account is already configured.');
    const user = one('SELECT * FROM users WHERE id=? AND disabled=0', req.user!.id);
    if (!user || user.is_demo || user.role !== 'customer') throw new ApiError(403, 'Sign in with your own registered customer account to activate the shop owner.');
    const key = req.ip ?? 'unknown';
    const attempt = setupAttempts.get(key);
    if (attempt && attempt.expires > Date.now() && attempt.count >= 5) throw new ApiError(429, 'Too many setup attempts. Try again in 15 minutes.');
    const body = z.object({ setupCode: z.string().min(1).max(128) }).strict().parse(req.body);
    const given = createHash('sha256').update(body.setupCode.trim()).digest();
    const expected = createHash('sha256').update(ownerSetupCode!).digest();
    if (!timingSafeEqual(given, expected)) {
      const current = attempt && attempt.expires > Date.now() ? attempt : { count: 0, expires: Date.now() + 900_000 };
      current.count++; setupAttempts.set(key, current);
      throw new ApiError(403, 'The owner activation code is incorrect. Use the code on your Mac.');
    }
    const result = transaction(() => {
      if (!needsOwner()) throw new ApiError(409, 'The shop owner account is already configured.');
      const current = one("SELECT * FROM users WHERE id=? AND disabled=0 AND is_demo=0 AND role='customer'", req.user!.id);
      if (!current) throw new ApiError(403, 'Choose an active registered customer account.');
      run("UPDATE users SET role='owner' WHERE id=?", current.id);
      run('UPDATE users SET disabled=1 WHERE is_demo=1');
      run('UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=? OR user_id IN (SELECT id FROM users WHERE is_demo=1)', now(), current.id);
      return authResult(one('SELECT * FROM users WHERE id=?', current.id)!);
    });
    setupAttempts.delete(key);
    notify('staff');
    res.json(result);
  });
  app.post('/api/auth/verify-contact', auth, async (req: AuthRequest, res) => {
    const body = z.object({ idToken: z.string().min(50).max(15000) }).parse(req.body);
    const identity = await verifyIdentity(body.idToken);
    const user = one('SELECT * FROM users WHERE id=?', req.user!.id)!;
    if (!identity.email || identity.email.toLowerCase() !== user.email.toLowerCase()) throw new ApiError(403, 'Use the Firebase account with the same email as this SmartShop account.');
    if (user.firebase_uid && user.firebase_uid !== identity.uid) throw new ApiError(403, 'This account is linked to a different Firebase identity.');
    const linked = one('SELECT id FROM users WHERE firebase_uid=? AND id<>?', identity.uid, user.id);
    if (linked) throw new ApiError(409, 'That verified identity is already linked to another SmartShop account.');
    run('UPDATE users SET firebase_uid=?,email_verified=?,phone_verified=?,phone=? WHERE id=?', identity.uid, identity.emailVerified ? 1 : 0, identity.phone ? 1 : 0, identity.phone ?? user.phone, user.id);
    res.json(publicUser(one('SELECT * FROM users WHERE id=?', user.id)!));
  });
  app.get('/api/shop', (_req, res) => {
    const row = one('SELECT * FROM shop WHERE id=1');
    if (!row) throw new ApiError(404, 'Shop not configured.');
    res.json(shopProfile(row));
  });
  app.get('/api/products', (req, res) => {
    const { search, category, page, limit } = z.object({ search: z.string().max(100).default(''), category: z.string().max(60).default(''), page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(8) }).parse(req.query);
    const where = " WHERE p.archived_at IS NULL AND p.name LIKE ? ESCAPE '\\' AND (?='' OR p.category=?)";
    const escapedSearch = search.replace(/[\\%_]/g, '\\$&');
    const args = [`%${escapedSearch}%`, category, category];
    const total = one(`SELECT COUNT(*) n FROM products p${where}`, ...args)!.n;
    const items = all(`${productSql}${where} ORDER BY p.id LIMIT ? OFFSET ?`, ...args, limit, (page - 1) * limit).map(row => product(row));
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)), categories: all('SELECT DISTINCT category FROM products WHERE archived_at IS NULL ORDER BY category').map(row => row.category) });
  });
  app.get('/api/products/:id', (req, res) => res.json(product(getProduct(z.coerce.number().int().positive().parse(req.params.id)))));
  const getReviews = (productId: number) => all('SELECT r.*,u.name author FROM reviews r JOIN users u ON u.id=r.user_id WHERE product_id=? ORDER BY created_at DESC,id DESC', productId).map(row => ({ id: row.id, productId: row.product_id, userId: row.user_id, author: row.author, rating: row.rating, body: row.body, createdAt: row.created_at }));
  app.get('/api/products/:id/reviews', (req, res) => { const id = z.coerce.number().int().positive().parse(req.params.id); getProduct(id); res.json(getReviews(id)); });
  app.post('/api/products/:id/reviews', auth, (req: AuthRequest, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id); getProduct(id);
    const body = z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().min(3).max(1500) }).parse(req.body);
    run('INSERT INTO reviews(product_id,user_id,rating,body,created_at) VALUES(?,?,?,?,?) ON CONFLICT(product_id,user_id) DO UPDATE SET rating=excluded.rating,body=excluded.body,created_at=excluded.created_at', id, req.user!.id, body.rating, body.body, now());
    notify('reviews', id);
    res.status(201).json(getReviews(id).find(review => review.userId === req.user!.id));
  });
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
    res.write(': connected\n\n'); clients.add(res);
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
    req.on('close', () => { clearInterval(timer); clients.delete(res); });
  });
  app.get('/api/inventory', auth, staff, (_req, res) => res.json(all(`${productSql} WHERE p.archived_at IS NULL ORDER BY p.id`).map(row => product(row, true))));
  app.get('/api/stock-alerts', auth, staff, (req: AuthRequest, res) => {
    const items = all(`SELECT p.id,p.name,p.stock,p.unit,p.reorder_level,
      CASE WHEN r.stock_at_read=p.stock AND r.reorder_at_read=p.reorder_level THEN 1 ELSE 0 END is_read
      FROM products p LEFT JOIN stock_alert_reads r ON r.product_id=p.id AND r.user_id=?
      WHERE p.archived_at IS NULL AND p.stock<=p.reorder_level ORDER BY p.stock,p.id`, req.user!.id).map(row => ({
        id: row.id, name: row.name, stock: row.stock, unit: row.unit, reorderLevel: row.reorder_level, read: !!row.is_read,
      }));
    res.json({ items, unreadCount: items.filter(item => !item.read).length });
  });
  app.post('/api/stock-alerts/read', auth, staff, (req: AuthRequest, res) => {
    const body = z.object({ productIds: z.array(z.number().int().positive()).max(500) }).parse(req.body);
    transaction(() => {
      for (const id of new Set(body.productIds)) {
        const p = one('SELECT stock,reorder_level FROM products WHERE id=? AND archived_at IS NULL AND stock<=reorder_level', id);
        if (p) run('INSERT INTO stock_alert_reads(user_id,product_id,stock_at_read,reorder_at_read,read_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,product_id) DO UPDATE SET stock_at_read=excluded.stock_at_read,reorder_at_read=excluded.reorder_at_read,read_at=excluded.read_at', req.user!.id, id, p.stock, p.reorder_level, now());
      }
    });
    notify('alerts');
    res.json({ ok: true });
  });
  app.post('/api/products', auth, staff, (req: AuthRequest, res) => {
    const body = productInput.parse(req.body);
    const asset = body.uploadId ? getProductPhoto(body.uploadId, req.user!.id) : undefined;
    if (body.imageUrl && !asset) throw new ApiError(400, 'Upload the product image before attaching it.');
    if (asset && body.imageUrl && asset.url !== body.imageUrl) throw new ApiError(400, 'The image URL does not match the uploaded image.');
    const id = transaction(() => {
      const result = run('INSERT INTO products(name,category,unit,price,cost,stock,reorder_level,description,emoji,image_url,upload_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', body.name, body.category, body.unit, body.price, body.cost, body.stock, body.reorderLevel, body.description, body.emoji, asset?.url ?? null, asset?.id ?? null, now());
      const id = Number(result.lastInsertRowid);
      run('INSERT INTO stock_movements(product_id,quantity,type,created_at) VALUES(?,?,?,?)', id, body.stock, 'opening', now());
      return id;
    });
    notify('catalog', id); notify('alerts'); res.status(201).json(product(getProduct(id), true));
  });
  app.patch('/api/products/:id', auth, staff, (req: AuthRequest, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = z.object({
      name: z.string().trim().min(2).max(120).optional(), category: z.string().trim().min(1).max(60).optional(),
      price: integer.optional(), reorderLevel: z.number().int().min(0).max(100_000).optional(),
      description: z.string().trim().max(2000).optional(),
      unit: z.string().trim().min(1).max(30).optional(), cost: integer.optional(), emoji: productIcon.optional(),
      stock: z.number().int().min(0).max(1_000_000).optional(), expectedStock: z.number().int().min(0).max(1_000_000).optional(),
      uploadId: z.number().int().positive().nullable().optional(),
    }).strict()
      .refine(value => Object.keys(value).length > 0, 'Enter at least one product detail to update.')
      .refine(value => (value.stock === undefined) === (value.expectedStock === undefined), 'Send the previous stock count with a stock adjustment.')
      .parse(req.body);
    const { uploadId, expectedStock, ...details } = body;
    if (req.user!.role !== 'owner' && [details.unit, details.cost, details.stock, details.emoji, uploadId].some(value => value !== undefined)) {
      throw new ApiError(403, 'Only the shop owner can change the unit, cost, stock count, icon or photo.');
    }
    const columns: Record<string, string> = {
      name: 'name', category: 'category', unit: 'unit', price: 'price', cost: 'cost', stock: 'stock',
      reorderLevel: 'reorder_level', description: 'description', emoji: 'emoji',
    };
    const updated = transaction(() => {
      const previous = getProduct(id);
      if (details.stock !== undefined && previous.stock !== expectedStock && previous.stock !== details.stock) {
        throw new ApiError(409, 'Stock changed while this form was open. Close and reopen the editor to see the current count.');
      }
      const updates = Object.entries(details).map(([key, value]) => [columns[key], value]);
      if (uploadId !== undefined) {
        const asset = uploadId === null ? null : getProductPhoto(uploadId, req.user!.id);
        updates.push(['upload_id', asset?.id ?? null], ['image_url', asset?.url ?? null]);
      }
      run(`UPDATE products SET ${updates.map(([column]) => `${column}=?`).join(',')} WHERE id=?`, ...updates.map(([, value]) => value), id);
      const stockChanged = details.stock !== undefined && details.stock !== previous.stock;
      if (stockChanged) {
        run('INSERT INTO stock_movements(product_id,quantity,type,created_at) VALUES(?,?,?,?)', id, details.stock! - previous.stock, 'adjustment', now());
      }
      if (stockChanged || (details.reorderLevel !== undefined && details.reorderLevel !== previous.reorder_level)) {
        run('DELETE FROM stock_alert_reads WHERE product_id=?', id);
      }
      return product(getProduct(id), true);
    });
    notify('catalog', id); notify('alerts');
    res.json(updated);
  });
  app.delete('/api/products/:id', auth, ownerOnly, (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const archived = transaction(() => {
      const row = one('SELECT archived_at FROM products WHERE id=?', id);
      if (!row) throw new ApiError(404, 'Product not found.');
      if (row.archived_at) return false;
      run('UPDATE products SET archived_at=? WHERE id=?', now(), id);
      run('DELETE FROM stock_alert_reads WHERE product_id=?', id);
      return true;
    });
    if (archived) { notify('catalog', id); notify('alerts'); }
    res.json({ ok: true });
  });
  app.post('/api/purchases', auth, staff, (req, res) => {
    const body = z.object({ productId: z.number().int().positive(), quantity, unitCost: integer, reference: z.string().trim().max(120).default(''), requestId }).parse(req.body);
    const result = cachedRequest('purchase', body.requestId, body, () => {
      const p = getProduct(body.productId);
      const stock = p.stock + body.quantity;
      if (stock > 1_000_000) throw new ApiError(400, 'The resulting stock is too large.');
      const inventoryValue = safeMoney(safeMoney(p.stock * p.cost) + safeMoney(body.quantity * body.unitCost));
      const cost = Math.round(inventoryValue / stock);
      const row = run('INSERT INTO purchases(product_id,quantity,unit_cost,reference,created_at) VALUES(?,?,?,?,?)', p.id, body.quantity, body.unitCost, body.reference, now());
      const id = Number(row.lastInsertRowid);
      run('UPDATE products SET stock=?,cost=? WHERE id=?', stock, cost, p.id);
      run('DELETE FROM stock_alert_reads WHERE product_id=?', p.id);
      run('INSERT INTO stock_movements(product_id,quantity,type,reference_id,created_at) VALUES(?,?,?,?,?)', p.id, body.quantity, 'purchase', id, now());
      recordActivity('purchase', `Purchase #${id}`, `${body.quantity} ${p.unit} · ${p.name}`, body.quantity * body.unitCost);
      return { id };
    });
    notify('catalog', body.productId); notify('alerts'); res.status(201).json(result);
  });
  app.post('/api/sales', auth, staff, (req: AuthRequest, res) => {
    const body = z.object({ items: z.array(z.object({ productId: z.number().int().positive(), quantity })).min(1).max(100), customerId: z.number().int().positive().optional(), customerName: z.string().trim().max(80).default(''), paid: integer, requestId, previousDuePayment: integer.optional() }).parse(req.body);
    const previousDuePayment = body.previousDuePayment ?? 0;
    if (new Set(body.items.map(item => item.productId)).size !== body.items.length) throw new ApiError(400, 'Combine duplicate product lines before confirming the sale.');
    if (previousDuePayment > 0 && !body.customerId) throw new ApiError(400, 'Choose an existing customer before collecting a previous balance.');
    const result = cachedRequest('sale', body.requestId, body, () => {
      const lines = body.items.map(item => { const p = getProduct(item.productId); if (p.stock < item.quantity) throw new ApiError(409, `Not enough stock for ${p.name}.`); return { ...item, product: p }; });
      const total = safeMoney(lines.reduce((sum, line) => sum + safeMoney(line.product.price * line.quantity), 0));
      const cost = safeMoney(lines.reduce((sum, line) => sum + safeMoney(line.product.cost * line.quantity), 0));
      if (body.paid > total) throw new ApiError(400, 'Payment cannot exceed the sale total.');
      if (body.paid < total && !body.customerName && !body.customerId) throw new ApiError(400, 'Choose or enter a customer when recording a due balance.');
      let customerId: number | null = null;
      let customerName = body.customerName;
      let previousDue = 0;
      if (body.customerId) {
        const customer = getCustomer(body.customerId);
        customerId = customer.id; customerName = customer.name;
        previousDue = customer.due;
        if (previousDuePayment > previousDue) throw new ApiError(400, 'The previous-balance payment exceeds this customer’s outstanding balance.');
        if (previousDuePayment > 0) recordReceipt(customerId!, req.user!.id, previousDuePayment, 'cash', 'Previous balance collected at checkout', dhakaDate());
      } else if (body.customerName) {
        customerId = Number(run('INSERT INTO customers(name,created_at) VALUES(?,?)', body.customerName, now()).lastInsertRowid);
      }
      const sale = run('INSERT INTO sales(customer_id,total,paid,cost,created_at,business_date) VALUES(?,?,?,?,?,?)', customerId, total, body.paid, cost, now(), dhakaDate());
      const id = Number(sale.lastInsertRowid);
      for (const line of lines) {
        run('INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost) VALUES(?,?,?,?,?)', id, line.productId, line.quantity, line.product.price, line.product.cost);
        run('UPDATE products SET stock=stock-? WHERE id=?', line.quantity, line.productId);
        run('DELETE FROM stock_alert_reads WHERE product_id=?', line.productId);
        run('INSERT INTO stock_movements(product_id,quantity,type,reference_id,created_at) VALUES(?,?,?,?,?)', line.productId, -line.quantity, 'sale', id, now());
      }
      recordActivity('sale', `Sale #${id}`, customerName || 'Walk-in customer', total);
      return { id, total, paid: body.paid, due: total - body.paid, previousDue, previousDuePayment, customerBalance: previousDue - previousDuePayment + total - body.paid };
    });
    notify('catalog'); notify('alerts'); if (previousDuePayment > 0) notify('payments'); res.status(201).json(result);
  });
  app.post('/api/expenses', auth, staff, (req, res) => {
    const body = z.object({ title: z.string().trim().min(2).max(120), amount: integer.refine(n => n > 0, 'Enter an amount greater than zero.'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), requestId }).parse(req.body);
    if (body.date && (!Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0,10) !== body.date)) throw new ApiError(400, 'Enter a valid expense date.');
    const result = cachedRequest('expense', body.requestId, body, () => {
      const row = run('INSERT INTO expenses(title,amount,business_date,created_at) VALUES(?,?,?,?)', body.title, body.amount, body.date ?? dhakaDate(), now());
      recordActivity('expense', body.title, body.date ?? dhakaDate(), body.amount);
      return { id: Number(row.lastInsertRowid) };
    });
    res.status(201).json(result);
  });
  app.get('/api/dashboard', auth, staff, (req: AuthRequest, res) => {
    const today = dhakaDate();
    const sales = one('SELECT COALESCE(SUM(total),0) sales,COALESCE(SUM(cost),0) cost,COALESCE(SUM(paid),0) collected,COUNT(*) count FROM sales WHERE business_date=?', today)!;
    const expenses = one('SELECT COALESCE(SUM(amount),0) n FROM expenses WHERE business_date=?', today)!.n;
    const dues = one(`SELECT
      COALESCE((SELECT SUM(opening_due) FROM customers),0)
      -COALESCE((SELECT SUM(opening_amount) FROM customer_receipts),0)
      +COALESCE((SELECT SUM(s.total-s.paid-COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a.sale_id=s.id),0)) FROM sales s),0) n`)!.n;
    const receiptCollections = one('SELECT COALESCE(SUM(amount),0) n FROM customer_receipts WHERE business_date=?', today)!.n;
    const salesSeries = Array.from({ length: 7 }, (_, i) => { const date = dhakaDate(new Date(Date.now() - (6-i) * 86_400_000)); return { date, sales: one('SELECT COALESCE(SUM(total),0) n FROM sales WHERE business_date=?', date)!.n }; });
    res.json({ sales: sales.sales, grossProfit: sales.sales - sales.cost, expenses, netProfit: sales.sales - sales.cost - expenses, cashCollected: sales.collected + receiptCollections, dues, lowStock: all(`${productSql} WHERE p.archived_at IS NULL AND p.stock<=p.reorder_level ORDER BY p.stock,p.id`).map(row => product(row, true)), salesSeries, totalProducts: one('SELECT COUNT(*) n FROM products WHERE archived_at IS NULL')!.n, transactionCount: sales.count, ...(req.user!.role === 'owner' ? { inventoryCost: one('SELECT COALESCE(SUM(stock*cost),0) n FROM products WHERE archived_at IS NULL')!.n } : {}), date: today });
  });
  app.get('/api/customers', auth, staff, (_req, res) => res.json(all(`${customerSql} GROUP BY c.id ORDER BY c.id DESC`).map(customerProfile)));
  app.post('/api/customers', auth, staff, (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(30).default(''), email: z.union([z.literal(''), z.string().email().max(254)]).default(''), address: z.string().trim().max(300).default(''), openingDue: integer.default(0) }).parse(req.body);
    const result = run('INSERT INTO customers(name,phone,email,address,opening_due,created_at) VALUES(?,?,?,?,?,?)', body.name, body.phone, body.email, body.address, body.openingDue, now());
    notify('payments');
    res.status(201).json(customerProfile(getCustomer(Number(result.lastInsertRowid))));
  });
  app.patch('/api/customers/:id', auth, staff, (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    getCustomer(id);
    const body = z.object({ name: z.string().trim().min(2).max(80).optional(), phone: z.string().trim().max(30).optional(), email: z.union([z.literal(''), z.string().trim().email().max(254)]).optional(), address: z.string().trim().max(300).optional() }).strict().refine(value => Object.keys(value).length > 0, 'Enter a contact detail to update.').parse(req.body);
    const entries = Object.entries(body);
    run(`UPDATE customers SET ${entries.map(([key]) => `${key}=?`).join(',')} WHERE id=?`, ...entries.map(([,value]) => value), id);
    notify('payments');
    res.json(customerProfile(getCustomer(id)));
  });
  app.get('/api/customers/:id/ledger', auth, staff, (req, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const customer = customerProfile(getCustomer(id));
    const sales = all(`SELECT s.*,COALESCE((SELECT SUM(a.amount) FROM receipt_allocations a WHERE a.sale_id=s.id),0) allocated FROM sales s WHERE customer_id=? ORDER BY created_at DESC,id DESC`, id).map(row => ({
      id: row.id, total: row.total, paid: row.paid, settled: row.paid + row.allocated,
      due: row.total - row.paid - row.allocated, createdAt: row.created_at,
    }));
    const payments = all('SELECT * FROM customer_receipts WHERE customer_id=? ORDER BY created_at DESC,id DESC', id).map(row => ({ id: row.id, amount: row.amount, method: row.method, note: row.note, date: row.business_date, createdAt: row.created_at }));
    res.json({ customer, sales, payments });
  });
  app.post('/api/customers/:id/payments', auth, staff, (req: AuthRequest, res) => {
    const id = z.coerce.number().int().positive().parse(req.params.id);
    const body = z.object({ amount: integer.refine(value => value > 0, 'Enter an amount greater than zero.'), method: paymentMethod, note: z.string().trim().max(300).default(''), date: businessDate.optional(), requestId }).parse(req.body);
    const result = cachedRequest('customer-payment', body.requestId, { customerId: id, ...body }, () => recordReceipt(id, req.user!.id, body.amount, body.method, body.note, body.date ?? dhakaDate()));
    notify('payments');
    res.status(201).json(result);
  });
  app.get('/api/activity', auth, staff, (_req, res) => res.json(all('SELECT * FROM activity ORDER BY id DESC LIMIT 30').map(row => ({ id: row.id, type: row.type, title: row.title, detail: row.detail, amount: row.amount, createdAt: row.created_at }))));
  mountCommunity(app, { db, auth, optionalAuth, notify, transaction });
  mountUploads(app, { db, auth, staff, notify });
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API endpoint not found.')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return void res.status(400).json({ error: error.issues[0]?.message ?? 'Check the entered details.' });
    if (error instanceof ApiError) return void res.status(error.status).json({ error: error.message });
    if (error instanceof ServiceError) return void res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError) return void res.status(400).json({ error: 'Invalid JSON request.' });
    console.error('SmartShop request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return { app, db, close: () => { for (const client of clients) client.end(); clients.clear(); db.close(); } };
}
