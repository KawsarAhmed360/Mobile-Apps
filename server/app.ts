import express, { type NextFunction, type Request, type Response } from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

type Row = Record<string, any>;
type Role = 'owner' | 'staff' | 'customer';
type AuthRequest = Request & { user?: { id: number; role: Role } };
type Options = { dbPath?: string; seed?: boolean; secret?: string; demo?: boolean };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const integer = z.number().int().min(0).max(100_000_000);
const quantity = z.number().int().min(1).max(100_000);
const requestId = z.string().min(8).max(120);
const productInput = z.object({
  name: z.string().trim().min(2).max(120), category: z.string().trim().min(1).max(60),
  unit: z.string().trim().min(1).max(30), price: integer, cost: integer,
  stock: z.number().int().min(0).max(100_000), reorderLevel: z.number().int().min(0).max(100_000),
  description: z.string().trim().max(2000).default(''), emoji: z.string().trim().max(16).default('📦'),
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

export function createApp(input: Options | string = {}) {
  const options = typeof input === 'string' ? { dbPath: input } : input;
  const dbPath = options.dbPath ?? resolve('.data/smartshop.sqlite');
  const demo = options.demo ?? process.env.NODE_ENV !== 'production';
  if (process.env.NODE_ENV === 'production' && demo) throw new Error('Demo mode must not run in production.');
  if (process.env.NODE_ENV === 'production') throw new Error('Production deployment requires configured verification, HTTPS and owner provisioning. This milestone is local development only.');
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
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
  `);

  const now = () => new Date().toISOString();
  const one = (sql: string, ...args: any[]) => db.prepare(sql).get(...args) as Row | undefined;
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as Row[];
  const run = (sql: string, ...args: any[]) => db.prepare(sql).run(...args);
  const transaction = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const recordActivity = (type: string, title: string, detail: string, amount = 0) =>
    run('INSERT INTO activity(type,title,detail,amount,created_at) VALUES(?,?,?,?,?)', type, title, detail, amount, now());

  if (options.seed !== false && !one('SELECT id FROM shop WHERE id=1')) {
    transaction(() => {
      run('INSERT INTO shop VALUES(1,?,?,?,?,?,?,?)', 'SmartShop', 'Your everyday essentials, thoughtfully stocked.', 'Demo shop location, Dhaka, Bangladesh', '+880 1700-000000', 'Every day · 9:00 AM – 10:00 PM', 23.8103, 90.4125);
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

  let secret = options.secret;
  if (!secret) {
    const path = dbPath === ':memory:' ? undefined : resolve(dirname(dbPath), 'session-secret');
    if (path && existsSync(path)) secret = readFileSync(path, 'utf8').trim();
    else {
      secret = randomBytes(48).toString('hex');
      if (path) writeFileSync(path, secret, { mode: 0o600 });
    }
  }
  const jwtSecret = secret;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); next(); });

  const auth = (req: AuthRequest, _res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) return next(new ApiError(401, 'Please sign in to continue.'));
    try {
      const payload = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      const user = one('SELECT id,role FROM users WHERE id=?', Number(payload.sub));
      if (!user) throw new Error('Missing user');
      req.user = { id: user.id, role: user.role };
      next();
    } catch { next(new ApiError(401, 'Your session has expired. Please sign in again.')); }
  };
  const staff = (req: AuthRequest, _res: Response, next: NextFunction) => req.user?.role === 'owner' || req.user?.role === 'staff' ? next() : next(new ApiError(403, 'This action requires shop staff access.'));
  const publicUser = (user: Row) => ({ id: user.id, name: user.name, username: user.username, email: user.email, role: user.role, emailVerified: false, phoneVerified: false });
  const authResult = (user: Row) => ({ token: jwt.sign({}, jwtSecret, { subject: String(user.id), expiresIn: '2h', algorithm: 'HS256' }), user: publicUser(user) });
  const product = (row: Row, privateFields = false) => ({
    id: row.id, name: row.name, category: row.category, unit: row.unit, price: row.price,
    description: row.description, emoji: row.emoji, inStock: row.stock > 0,
    averageRating: Number(row.rating ?? 0), reviewCount: Number(row.review_count ?? 0),
    ...(privateFields ? { cost: row.cost, stock: row.stock, reorderLevel: row.reorder_level } : {}),
  });
  const productSql = 'SELECT p.*, COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id=p.id),0) rating, (SELECT COUNT(*) FROM reviews WHERE product_id=p.id) review_count FROM products p';
  const getProduct = (id: number) => { const row = one(`${productSql} WHERE p.id=?`, id); if (!row) throw new ApiError(404, 'Product not found.'); return row; };
  const clients = new Set<Response>();
  const notify = (type: 'catalog' | 'reviews', productId?: number) => {
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

  app.get('/api/health', (_req, res) => res.json({ ok: true, demo, verificationConfigured: false }));
  const loginAttempts = new Map<string, { count: number; expires: number }>();
  app.post('/api/auth/login', (req, res) => {
    const body = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(128) }).parse(req.body);
    const key = `${req.ip}:${body.email.toLowerCase()}`;
    const attempt = loginAttempts.get(key);
    if (attempt && attempt.expires > Date.now() && attempt.count >= 10) throw new ApiError(429, 'Too many attempts. Please try again in a few minutes.');
    const user = one('SELECT * FROM users WHERE email=? COLLATE NOCASE', body.email.trim());
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
  app.post('/api/auth/register', (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), username: usernameSchema, email: z.string().trim().email().max(254), password: z.string().min(8).max(128) }).parse(req.body);
    if (one('SELECT id FROM users WHERE username=? COLLATE NOCASE OR email=? COLLATE NOCASE', body.username, body.email)) throw new ApiError(409, 'That username or email is already registered.');
    const result = run('INSERT INTO users(name,username,email,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', body.name, body.username, body.email.toLowerCase(), hashPassword(body.password), 'customer', now());
    res.status(201).json(authResult(one('SELECT * FROM users WHERE id=?', Number(result.lastInsertRowid))!));
  });
  app.get('/api/shop', (_req, res) => {
    const row = one('SELECT * FROM shop WHERE id=1');
    if (!row) throw new ApiError(404, 'Shop not configured.');
    res.json({ name: row.name, tagline: row.tagline, address: row.address, phone: row.phone, email: 'demo@smartshop.local', openingHours: row.opening_hours, latitude: row.latitude, longitude: row.longitude, currency: 'BDT', demo });
  });
  app.get('/api/products', (req, res) => {
    const { search, category, page, limit } = z.object({ search: z.string().max(100).default(''), category: z.string().max(60).default(''), page: z.coerce.number().int().min(1).max(100_000).default(1), limit: z.coerce.number().int().min(1).max(100).default(8) }).parse(req.query);
    const where = " WHERE p.name LIKE ? ESCAPE '\\' AND (?='' OR p.category=?)";
    const escapedSearch = search.replace(/[\\%_]/g, '\\$&');
    const args = [`%${escapedSearch}%`, category, category];
    const total = one(`SELECT COUNT(*) n FROM products p${where}`, ...args)!.n;
    const items = all(`${productSql}${where} ORDER BY p.id LIMIT ? OFFSET ?`, ...args, limit, (page - 1) * limit).map(row => product(row));
    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)), categories: all('SELECT DISTINCT category FROM products ORDER BY category').map(row => row.category) });
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
  app.get('/api/inventory', auth, staff, (_req, res) => res.json(all(`${productSql} ORDER BY p.id`).map(row => product(row, true))));
  app.post('/api/products', auth, staff, (req, res) => {
    const body = productInput.parse(req.body);
    const id = transaction(() => {
      const result = run('INSERT INTO products(name,category,unit,price,cost,stock,reorder_level,description,emoji,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', body.name, body.category, body.unit, body.price, body.cost, body.stock, body.reorderLevel, body.description, body.emoji, now());
      const id = Number(result.lastInsertRowid);
      run('INSERT INTO stock_movements(product_id,quantity,type,created_at) VALUES(?,?,?,?)', id, body.stock, 'opening', now());
      return id;
    });
    notify('catalog', id); res.status(201).json(product(getProduct(id), true));
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
      run('INSERT INTO stock_movements(product_id,quantity,type,reference_id,created_at) VALUES(?,?,?,?,?)', p.id, body.quantity, 'purchase', id, now());
      recordActivity('purchase', `Purchase #${id}`, `${body.quantity} ${p.unit} · ${p.name}`, body.quantity * body.unitCost);
      return { id };
    });
    notify('catalog', body.productId); res.status(201).json(result);
  });
  app.post('/api/sales', auth, staff, (req, res) => {
    const body = z.object({ items: z.array(z.object({ productId: z.number().int().positive(), quantity })).min(1).max(100), customerId: z.number().int().positive().optional(), customerName: z.string().trim().max(80).default(''), paid: integer, requestId }).parse(req.body);
    if (new Set(body.items.map(item => item.productId)).size !== body.items.length) throw new ApiError(400, 'Combine duplicate product lines before confirming the sale.');
    const result = cachedRequest('sale', body.requestId, body, () => {
      const lines = body.items.map(item => { const p = getProduct(item.productId); if (p.stock < item.quantity) throw new ApiError(409, `Not enough stock for ${p.name}.`); return { ...item, product: p }; });
      const total = safeMoney(lines.reduce((sum, line) => sum + safeMoney(line.product.price * line.quantity), 0));
      const cost = safeMoney(lines.reduce((sum, line) => sum + safeMoney(line.product.cost * line.quantity), 0));
      if (body.paid > total) throw new ApiError(400, 'Payment cannot exceed the sale total.');
      if (body.paid < total && !body.customerName && !body.customerId) throw new ApiError(400, 'Choose or enter a customer when recording a due balance.');
      let customerId: number | null = null;
      let customerName = body.customerName;
      if (body.customerId) {
        const customer = one('SELECT * FROM customers WHERE id=?', body.customerId);
        if (!customer) throw new ApiError(404, 'Customer not found.');
        customerId = customer.id; customerName = customer.name;
      } else if (body.customerName) {
        customerId = Number(run('INSERT INTO customers(name,created_at) VALUES(?,?)', body.customerName, now()).lastInsertRowid);
      }
      const sale = run('INSERT INTO sales(customer_id,total,paid,cost,created_at,business_date) VALUES(?,?,?,?,?,?)', customerId, total, body.paid, cost, now(), dhakaDate());
      const id = Number(sale.lastInsertRowid);
      for (const line of lines) {
        run('INSERT INTO sale_items(sale_id,product_id,quantity,unit_price,unit_cost) VALUES(?,?,?,?,?)', id, line.productId, line.quantity, line.product.price, line.product.cost);
        run('UPDATE products SET stock=stock-? WHERE id=?', line.quantity, line.productId);
        run('INSERT INTO stock_movements(product_id,quantity,type,reference_id,created_at) VALUES(?,?,?,?,?)', line.productId, -line.quantity, 'sale', id, now());
      }
      recordActivity('sale', `Sale #${id}`, customerName || 'Walk-in customer', total);
      return { id, total, paid: body.paid, due: total - body.paid };
    });
    notify('catalog'); res.status(201).json(result);
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
    const dues = one('SELECT COALESCE(SUM(total-paid),0) n FROM sales')!.n;
    const salesSeries = Array.from({ length: 7 }, (_, i) => { const date = dhakaDate(new Date(Date.now() - (6-i) * 86_400_000)); return { date, sales: one('SELECT COALESCE(SUM(total),0) n FROM sales WHERE business_date=?', date)!.n }; });
    res.json({ sales: sales.sales, grossProfit: sales.sales - sales.cost, expenses, netProfit: sales.sales - sales.cost - expenses, cashCollected: sales.collected, dues, lowStock: all(`${productSql} WHERE p.stock<=p.reorder_level ORDER BY p.stock,p.id`).map(row => product(row, true)), salesSeries, totalProducts: one('SELECT COUNT(*) n FROM products')!.n, transactionCount: sales.count, ...(req.user!.role === 'owner' ? { inventoryCost: one('SELECT COALESCE(SUM(stock*cost),0) n FROM products')!.n } : {}), date: today });
  });
  app.get('/api/customers', auth, staff, (_req, res) => res.json(all('SELECT c.*,COALESCE(SUM(s.total),0) total_spent,COALESCE(SUM(s.total-s.paid),0) due,COUNT(s.id) orders FROM customers c LEFT JOIN sales s ON s.customer_id=c.id GROUP BY c.id ORDER BY c.id DESC').map(row => ({ id: row.id, name: row.name, phone: row.phone, email: row.email, address: row.address, totalSpent: row.total_spent, due: row.due, purchases: row.orders }))));
  app.post('/api/customers', auth, staff, (req, res) => {
    const body = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(30).default(''), email: z.union([z.literal(''), z.string().email().max(254)]).default(''), address: z.string().trim().max(300).default('') }).parse(req.body);
    const result = run('INSERT INTO customers(name,phone,email,address,created_at) VALUES(?,?,?,?,?)', body.name, body.phone, body.email, body.address, now());
    res.status(201).json({ id: Number(result.lastInsertRowid), ...body, purchases: 0, totalSpent: 0, due: 0 });
  });
  app.get('/api/activity', auth, staff, (_req, res) => res.json(all('SELECT * FROM activity ORDER BY id DESC LIMIT 30').map(row => ({ id: row.id, type: row.type, title: row.title, detail: row.detail, amount: row.amount, createdAt: row.created_at }))));
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'API endpoint not found.')));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return void res.status(400).json({ error: error.issues[0]?.message ?? 'Check the entered details.' });
    if (error instanceof ApiError) return void res.status(error.status).json({ error: error.message });
    if (error instanceof SyntaxError) return void res.status(400).json({ error: 'Invalid JSON request.' });
    console.error('SmartShop request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return { app, db, close: () => { for (const client of clients) client.end(); clients.clear(); db.close(); } };
}
