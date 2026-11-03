import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity as ActivityIcon, ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, CreditCard, FileText, LayoutDashboard, Leaf, LogIn, LogOut, MapPin, Minus, MoreHorizontal, Package, Plus, Receipt, Search, ShoppingBag, ShoppingBasket, ShoppingCart, SlidersHorizontal, Sparkles, Star, Store, TrendingUp, Users, Wallet, X } from 'lucide-react';
import type { Activity, Customer, Dashboard, InventoryProduct, Product, Review, Shop, User } from '../shared/types';
import { ApiError, api, post, setAccessToken, subscribeToChanges } from './api';
import { newRequestId } from './requestId';
import { asCents, dayLabel, Empty, ErrorNotice, Field, Loading, Modal, money, ProductArt, SubmitButton } from './components';

type Page = 'dashboard' | 'inventory' | 'sales' | 'customers' | 'catalog' | 'shop';
type Dialog = 'login' | 'product' | 'purchase' | 'expense' | null;
type ProductPage = { items: Product[]; total: number; page: number; pages: number; categories: string[] };

function useResource<T>(path: string | null, revision = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!path) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    api<T>(path).then(value => { if (!cancelled) setData(value); }).catch(e => { if (!cancelled) setError(e.message || 'Could not load data.'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [path, revision]);
  return { data, loading, error };
}

const ownerNavigation = [
  { id: 'dashboard' as Page, label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory' as Page, label: 'Products & stock', icon: Package },
  { id: 'sales' as Page, label: 'New sale', icon: ShoppingCart },
  { id: 'customers' as Page, label: 'Customers', icon: Users },
];

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: 'A good day to grow.', subtitle: 'Here’s what’s happening in your shop today.' },
  inventory: { title: 'Everything in its place.', subtitle: 'Your products, prices and stock. All together.' },
  sales: { title: 'Let’s make a sale.', subtitle: 'A simple checkout. Stock takes care of itself.' },
  customers: { title: 'Know your regulars.', subtitle: 'Keep track of your customers and their balances.' },
  catalog: { title: 'Good things, close to home.', subtitle: 'Explore what’s available at your neighbourhood shop.' },
  shop: { title: 'Your neighbourhood shop.', subtitle: 'A little closer. A little more convenient.' },
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('catalog');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const shop = useResource<Shop>('/shop');
  const staff = user?.role === 'owner' || user?.role === 'staff';
  const ownerView = !!staff && !['catalog', 'shop'].includes(page);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const notify = useCallback((message: string) => { setToast(message); refresh(); }, [refresh]);
  useEffect(() => subscribeToChanges(refresh), [refresh]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timeout); }, [toast]);
  const onLogin = (result: { token: string; user: User }) => {
    setAccessToken(result.token);
    setUser(result.user);
    setDialog(null);
    if (result.user.role === 'owner' || result.user.role === 'staff') setPage('dashboard');
    notify(`Welcome, ${result.user.name.split(' ')[0]}!`);
  };
  const logout = () => { setAccessToken(null); setUser(null); setPage('catalog'); setSearch(''); notify('You have signed out.'); };
  const navigate = (next: Page) => { setPage(next); setSearch(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date());

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate(staff ? 'dashboard' : 'catalog')} aria-label="SmartShop home"><span className="brand-icon"><ShoppingBag size={25} strokeWidth={1.8} /><span /></span><span>smart<span className="brand-light">shop</span><small>YOUR SHOP. SIMPLIFIED.</small></span></button>
      <div className="shop-identity"><div className="shop-avatar"><Store size={20} /></div><div><strong>{shop.data?.name || 'SmartShop'}</strong><span>Single-shop workspace</span></div><span className="status-dot" /></div>
      <p className="nav-section">{ownerView ? 'MANAGE YOUR SHOP' : 'DISCOVER YOUR SHOP'}</p>
      <nav aria-label="Main navigation">{(ownerView ? ownerNavigation : [{ id: 'catalog' as Page, label: 'Shop products', icon: ShoppingBasket }, { id: 'shop' as Page, label: 'Visit our shop', icon: MapPin }]).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={20} /><span>{item.label}</span>{page === item.id && <span className="nav-active-dot" />}</button>)}</nav>
      {ownerView && <div className="sidebar-secondary"><p className="nav-section">A DIFFERENT PERSPECTIVE</p><button className="nav-item" onClick={() => navigate('catalog')}><Store size={20} /><span>Customer storefront</span><ArrowUpRight size={15} /></button></div>}
      {!ownerView && staff && <div className="sidebar-secondary"><button className="nav-item" onClick={() => navigate('dashboard')}><LayoutDashboard size={20} /><span>Back to dashboard</span><ArrowRight size={15} /></button></div>}
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Leaf size={22} /></div><strong>A little smarter, every day.</strong><p>One place for your products, people and everyday numbers.</p></div>{user ? <div className="account"><span className="account-avatar">{user.name.charAt(0).toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.role === 'owner' ? 'Shop owner' : user.role === 'staff' ? 'Team member' : 'Customer'}</span></div><button className="icon-button" aria-label="Sign out" onClick={logout}><LogOut size={18} /></button></div> : <button className="button button-primary login-sidebar" onClick={() => setDialog('login')}><LogIn size={17} /> Sign in</button>}</div>
    </aside>

    <div className="main-column">
      <div className="preview-banner"><span className="preview-dot" /><span>Development preview <span className="banner-separator">·</span> Sample shop data</span><span className="preview-right">Your first SmartShop build <Sparkles size={12} /></span></div>
      <header className="topbar"><div className="mobile-brand"><ShoppingBag size={22} /><strong>smart<span>shop</span></strong></div><div className="breadcrumb"><span>{ownerView ? 'Workspace' : 'Our shop'}</span><ChevronRight size={14} /><strong>{ownerView ? ownerNavigation.find(n => n.id === page)?.label : page === 'shop' ? 'Location & details' : 'Products'}</strong></div><div className="topbar-actions"><span className="date-label"><Clock3 size={15} />{today}</span>{ownerView && <button className="icon-button storefront-switch" aria-label="Open customer storefront" title="Customer storefront" onClick={() => navigate('catalog')}><Store size={19} /></button>}{user ? <button className="topbar-account" aria-label={`Signed in as ${user.name}. Sign out`} onClick={logout}>{user.name.charAt(0).toUpperCase()}</button> : <button className="button button-small button-outline" onClick={() => setDialog('login')}>Sign in <ArrowRight size={15} /></button>}</div></header>

      <main className={`main-content ${page === 'sales' ? 'checkout-main' : ''}`}>
        <div className="page-heading"><div><p className="eyebrow"><span />{ownerView ? 'YOUR BUSINESS, AT A GLANCE' : 'WELCOME TO SMARTSHOP'}</p><h1>{pageTitles[page].title}</h1><p className="page-subtitle">{pageTitles[page].subtitle}</p></div><div className="page-actions">{ownerView && page === 'dashboard' && <><button className="button button-outline" onClick={() => setDialog('expense')}><Plus size={17} /> Add expense</button><button className="button button-primary" onClick={() => navigate('sales')}><Plus size={18} /> New sale</button></>}{page === 'inventory' && <><button className="button button-outline" onClick={() => setDialog('purchase')}><ArrowDownToLine size={17} /> Add purchase</button><button className="button button-primary" onClick={() => setDialog('product')}><Plus size={18} /> Add product</button></>}{!ownerView && staff && <button className="button button-outline mobile-dashboard-link" onClick={() => navigate('dashboard')}><LayoutDashboard size={17} /> Dashboard</button>}</div></div>

        <AnimatePresence mode="wait"><motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.18 }}>
          {page === 'dashboard' && staff && <DashboardPage revision={revision} onSale={() => navigate('sales')} onPurchase={() => setDialog('purchase')} />}
          {page === 'inventory' && staff && <InventoryPage revision={revision} search={search} setSearch={setSearch} onAdd={() => setDialog('product')} onPurchase={() => setDialog('purchase')} />}
          {page === 'sales' && staff && <SalesPage revision={revision} onSuccess={notify} />}
          {page === 'customers' && staff && <CustomersPage revision={revision} />}
          {page === 'catalog' && <CatalogPage revision={revision} search={search} setSearch={setSearch} onSelect={setSelectedProduct} onShop={() => navigate('shop')} />}
          {page === 'shop' && <ShopPage shop={shop.data} loading={shop.loading} error={shop.error} />}
        </motion.div></AnimatePresence>
        <footer className="page-footer"><span><Leaf size={13} /> Made for everyday business.</span><span>SmartShop <span className="footer-dot">·</span> Android development preview</span></footer>
      </main>
    </div>

    <nav className="mobile-nav" aria-label="Mobile navigation">{(ownerView ? ownerNavigation : [{ id: 'catalog' as Page, label: 'Products', icon: ShoppingBasket }, { id: 'shop' as Page, label: 'Our shop', icon: MapPin }]).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={21} /><span>{item.label === 'Products & stock' ? 'Stock' : item.label}</span></button>)}{!ownerView && <button onClick={() => user ? logout() : setDialog('login')}>{user ? <LogOut size={21} /> : <LogIn size={21} />}<span>{user ? 'Sign out' : 'Sign in'}</span></button>}</nav>

    {dialog === 'login' && <AuthDialog onClose={() => setDialog(null)} onLogin={onLogin} />}
    {dialog === 'product' && staff && <AddProductDialog onClose={() => setDialog(null)} onSuccess={message => { setDialog(null); notify(message); }} />}
    {dialog === 'purchase' && staff && <PurchaseDialog revision={revision} onClose={() => setDialog(null)} onSuccess={message => { setDialog(null); notify(message); }} />}
    {dialog === 'expense' && staff && <ExpenseDialog onClose={() => setDialog(null)} onSuccess={message => { setDialog(null); notify(message); }} />}
    {selectedProduct && <ProductDialog product={selectedProduct} user={user} revision={revision} onClose={() => setSelectedProduct(null)} onLogin={() => setDialog('login')} onSuccess={notify} />}
    <AnimatePresence>{toast && <motion.div className="toast" role="status" initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 15, opacity: 0 }}><CheckCircle2 size={19} /><span>{toast}</span><button aria-label="Dismiss notification" onClick={() => setToast('')}><X size={16} /></button></motion.div>}</AnimatePresence>
  </div>;
}

function DashboardPage({ revision, onSale, onPurchase }: { revision: number; onSale: () => void; onPurchase: () => void }) {
  const { data, loading, error } = useResource<Dashboard>('/dashboard', revision);
  const activity = useResource<Activity[]>('/activity', revision);
  if (!data && loading) return <Loading />;
  if (error || !data) return <ErrorNotice>{error || 'Dashboard is unavailable.'}</ErrorNotice>;
  const stats = [
    { label: 'Today’s sales', value: data.sales, icon: ShoppingBag, detail: 'Total confirmed sales today', color: 'green' },
    { label: 'Gross profit', value: data.grossProfit, icon: TrendingUp, detail: 'Sales minus cost of goods', color: 'blue' },
    { label: 'Today’s expenses', value: data.expenses, icon: Wallet, detail: 'Your recorded shop expenses', color: 'orange' },
    { label: 'Net profit', value: data.netProfit, icon: BarChart3, detail: 'After today’s expenses', color: 'purple' },
  ];
  const trend = data.salesSeries || [];
  const peak = Math.max(...trend.map(day => day.sales), 1);
  return <>
    <div className="stats-grid">{stats.map((stat, i) => <motion.div className={`stat-card ${i === 0 ? 'stat-featured' : ''}`} key={stat.label} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.05 }}><div className="stat-top"><span>{stat.label}</span><span className={`stat-icon ${stat.color}`}><stat.icon size={19} /></span></div><strong className="stat-value">{money(stat.value)}</strong><div className="stat-bottom"><span className="mini-dot" />{stat.detail}</div></motion.div>)}</div>
    <div className="dashboard-middle"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Sales at a glance</h2><p>A little progress, every day.</p></div><span className="period-pill"><span className="mini-dot" />Last 7 days</span></div><div className="chart-total"><strong>{money(trend.reduce((n, day) => n + day.sales, 0))}</strong><span>total sales this week</span></div><div className="bar-chart" role="img" aria-label={`Daily sales: ${trend.map(day => `${dayLabel(day.date)} ${money(day.sales)}`).join(', ')}`}><div className="chart-guides"><span>{money(peak)}</span><span>{money(peak / 2)}</span><span>৳0</span></div><div className="chart-bars">{trend.map((day, index) => <div className={`chart-column ${index === trend.length - 1 ? 'today' : ''}`} key={day.date}><div className="bar-track"><motion.div className="bar-fill" initial={{ height: 0 }} animate={{ height: `${Math.max((day.sales / peak) * 100, day.sales > 0 ? 3 : 0)}%` }} transition={{ delay: index * 0.035, duration: 0.45 }}><span className="bar-tooltip">{money(day.sales)}</span></motion.div></div><span>{new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Asia/Dhaka' }).format(new Date(day.date))}</span></div>)}</div></div><div className="chart-note"><span className="chart-key" />Daily sales <span>Updated as sales are recorded</span></div></section>
    <section className="panel stock-panel"><div className="panel-heading"><div><h2>Needs a little attention</h2><p>Keep your shelves ready.</p></div><span className="count-pill orange">{data.lowStock.length}</span></div><div className="low-stock-intro"><Package size={16} /><span>At or below your reorder level</span></div><div className="low-stock-list">{data.lowStock.length === 0 ? <Empty title="Your shelves look good" message="No products need restocking right now." /> : data.lowStock.slice(0, 4).map(product => <div className="stock-row" key={product.id}><ProductArt emoji={product.emoji} category={product.category} small /><div><strong>{product.name}</strong><span>{product.category}</span></div><span className={`stock-badge ${product.stock === 0 ? 'out' : ''}`}>{product.stock === 0 ? 'Out of stock' : `${product.stock} ${product.unit} left`}</span></div>)}</div><button className="text-button stock-action" onClick={onPurchase}>Record a purchase <ArrowRight size={16} /></button></section></div>
    <div className="dashboard-bottom"><section className="panel activity-panel"><div className="panel-heading"><div><h2>The latest in your shop</h2><p>Your recent transactions.</p></div><span className="subtle-icon"><ActivityIcon size={19} /></span></div>{activity.error && <ErrorNotice>{activity.error}</ErrorNotice>}{activity.loading && !activity.data ? <Loading label="Loading activity…" /> : !activity.data?.length ? <Empty title="A fresh start" message="Your sales, purchases and expenses will appear here." /> : <div className="activity-list">{activity.data.slice(0, 5).map(item => <div className="activity-row" key={`${item.type}-${item.id}`}><span className={`activity-symbol ${item.type === 'sale' ? 'green' : item.type === 'purchase' ? 'blue' : 'orange'}`}>{item.type === 'sale' ? <ArrowUpRight size={19} /> : item.type === 'purchase' ? <ArrowDownLeft size={19} /> : <Receipt size={19} />}</span><div><strong>{item.title}</strong><span>{item.type === 'sale' ? 'Sale recorded' : item.type === 'purchase' ? 'Stock replenished' : 'Expense recorded'}</span></div><div className="activity-amount"><strong>{money(item.amount)}</strong><span>{dayLabel(item.createdAt)}</span></div></div>)}</div>}</section><section className="daily-note"><span className="daily-note-icon"><Leaf size={28} /></span><p className="eyebrow">SMALL DETAILS. BIG DIFFERENCE.</p><h2>Your numbers,<br />working for you.</h2><p>You’ve collected <strong>{money(data.cashCollected)}</strong> from today’s sales. Keep sales and cash received separate for a clearer picture.</p><div className="note-balance"><span>Total customer dues</span><strong>{money(data.dues)}</strong></div><button className="button button-dark" onClick={onSale}>Record your next sale <ArrowRight size={17} /></button></section></div>
  </>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="search-box"><Search size={18} /><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />{value && <button aria-label="Clear search" onClick={() => onChange('')}><X size={16} /></button>}</div>;
}

function CatalogPage({ revision, search, setSearch, onSelect, onShop }: { revision: number; search: string; setSearch: (value: string) => void; onSelect: (product: Product) => void; onShop: () => void }) {
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(search);
  useEffect(() => { const timeout = setTimeout(() => { setQuery(search); setPage(1); }, 220); return () => clearTimeout(timeout); }, [search]);
  const result = useResource<ProductPage>(`/products?search=${encodeURIComponent(query)}&category=${encodeURIComponent(category)}&page=${page}&limit=8`, revision);
  return <><section className="catalog-hero"><div><span className="hero-tag"><Leaf size={14} /> EVERYDAY ESSENTIALS, ALL IN ONE PLACE</span><h2>Your favourites.<br /><span>Just around the corner.</span></h2><p>Check what’s in stock before you stop by.</p><button className="text-button" onClick={onShop}>Find our shop <ArrowRight size={16} /></button></div><div className="hero-art" aria-hidden="true"><div className="hero-orbit" /><div className="hero-bag"><ShoppingBasket size={78} strokeWidth={1.1} /><span className="hero-leaf">🌿</span></div><span className="hero-fruit fruit-one">🍊</span><span className="hero-fruit fruit-two">🥛</span><span className="hero-fruit fruit-three">🍎</span><div className="hero-stock"><span className="status-dot" />Fresh finds, close by</div></div></section>
    <div className="catalog-toolbar"><div><h2>Explore the shelves <span className="muted-number">{result.data?.total ?? '—'}</span></h2><p>Something for every day.</p></div><SearchBox value={search} onChange={setSearch} placeholder="Search products…" /></div>
    <div className="category-list" aria-label="Filter products by category"><button className={!category ? 'category-chip active' : 'category-chip'} onClick={() => { setCategory(''); setPage(1); }}>All products</button>{result.data?.categories.map(item => <button className={category === item ? 'category-chip active' : 'category-chip'} key={item} onClick={() => { setCategory(item); setPage(1); }}>{item}</button>)}</div>
    <ErrorNotice>{result.error}</ErrorNotice>{result.loading && !result.data ? <Loading label="Finding your favourites…" /> : result.data?.items.length ? <div className="product-grid">{result.data.items.map((product, i) => <motion.button className="product-card" key={product.id} onClick={() => onSelect(product)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.18) }}><div className="product-image-wrap"><ProductArt emoji={product.emoji} category={product.category} /><span className={`availability ${product.inStock ? '' : 'unavailable'}`}><span />{product.inStock ? 'In stock' : 'Out of stock'}</span><span className="product-open"><ArrowUpRight size={18} /></span></div><div className="product-info"><span className="product-category">{product.category}</span><h3>{product.name}</h3><div className="product-bottom"><strong>{money(product.price)}<small> / {product.unit}</small></strong><span className="product-rating"><Star size={13} fill={product.reviewCount ? 'currentColor' : 'none'} />{product.reviewCount ? product.averageRating.toFixed(1) : 'New'}<small>{product.reviewCount > 0 && `(${product.reviewCount})`}</small></span></div></div></motion.button>)}</div> : <Empty title="No products found" message="Try a different search or category." />}
    {result.data && result.data.pages > 1 && <div className="pagination"><span>Page {page} of {result.data.pages}</span><div><button className="button button-small button-outline" disabled={page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={16} /> Previous</button><button className="button button-small button-outline" disabled={page >= result.data.pages} onClick={() => setPage(n => n + 1)}>Next <ChevronRight size={16} /></button></div></div>}
  </>;
}

function InventoryPage({ revision, search, setSearch, onAdd, onPurchase }: { revision: number; search: string; setSearch: (value: string) => void; onAdd: () => void; onPurchase: () => void }) {
  const result = useResource<InventoryProduct[]>('/inventory', revision);
  const [lowOnly, setLowOnly] = useState(false);
  const items = result.data?.filter(p => `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase()) && (!lowOnly || p.stock <= p.reorderLevel)) ?? [];
  return <><div className="inventory-summary"><div><span className="inventory-summary-icon"><Package size={21} /></span><div><strong>{result.data?.length ?? 0}</strong><span>Products in your shop</span></div></div><div><span className="inventory-summary-icon sage"><Wallet size={21} /></span><div><strong>{money(result.data?.reduce((n, p) => n + p.stock * p.cost, 0) ?? 0)}</strong><span>Stock value at cost</span></div></div><div><span className="inventory-summary-icon peach"><ActivityIcon size={21} /></span><div><strong>{result.data?.filter(p => p.stock <= p.reorderLevel).length ?? 0}</strong><span>Need restocking</span></div></div></div><section className="panel inventory-panel"><div className="table-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search products or categories…" /><button className={`button button-outline button-small ${lowOnly ? 'filter-active' : ''}`} onClick={() => setLowOnly(v => !v)} aria-pressed={lowOnly}><SlidersHorizontal size={16} />Low stock {lowOnly && <Check size={14} />}</button></div><ErrorNotice>{result.error}</ErrorNotice>{result.loading && !result.data ? <Loading /> : !items.length ? <Empty title="Your shelves start here" message={search || lowOnly ? 'No products match your filters.' : 'Add a product and give your shop a fresh start.'}>{!search && !lowOnly && <button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add your first product</button>}</Empty> : <div className="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Cost price</th><th>Selling price</th><th>Stock</th><th>Status</th></tr></thead><tbody>{items.map(p => <tr key={p.id}><td><div className="table-product"><ProductArt emoji={p.emoji} category={p.category} small /><div><strong>{p.name}</strong><span>Per {p.unit}</span></div></div></td><td><span className="category-label">{p.category}</span></td><td>{money(p.cost)}</td><td className="strong-cell">{money(p.price)}</td><td>{p.stock} <span className="muted">{p.unit}</span></td><td><span className={`pill ${p.stock === 0 ? 'pill-red' : p.stock <= p.reorderLevel ? 'pill-orange' : 'pill-green'}`}><span />{p.stock === 0 ? 'Out of stock' : p.stock <= p.reorderLevel ? 'Low stock' : 'In stock'}</span></td></tr>)}</tbody></table></div>}<div className="table-footer"><span>{items.length} products <span className="footer-dot">·</span> Stock updates with every sale and purchase</span><button className="text-button" onClick={onPurchase}>Record purchase <ArrowRight size={15} /></button></div></section></>;
}

function SalesPage({ revision, onSuccess }: { revision: number; onSuccess: (message: string) => void }) {
  const inventory = useResource<InventoryProduct[]>('/inventory', revision);
  const customers = useResource<Customer[]>('/customers', revision);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Record<number, number>>({});
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<{ id: number; total: number; paid: number; due: number } | null>(null);
  const pending = useRef<{ items: { productId: number; quantity: number }[]; customerId?: number; customerName?: string; paid: number; requestId: string } | null>(null);
  const [locked, setLocked] = useState(false);
  const products = inventory.data ?? [];
  const rows = products.filter(p => cart[p.id]).map(p => ({ ...p, quantity: cart[p.id] }));
  const total = rows.reduce((n, p) => n + p.price * p.quantity, 0);
  const payment = paid === '' ? total : asCents(paid);
  const invalid = total <= 0 || payment < 0 || payment > total || (payment < total && !customerId && !customerName.trim());
  const add = (p: InventoryProduct) => { if (locked) return; setCart(old => ({ ...old, [p.id]: Math.min((old[p.id] || 0) + 1, p.stock) })); };
  const change = (id: number, delta: number) => { if (locked) return; const product = products.find(p => p.id === id); if (!product) return; setCart(old => ({ ...old, [id]: Math.min(Math.max((old[id] || 0) + delta, 0), product.stock) })); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (!pending.current && invalid)) return;
    if (!pending.current) pending.current = { items: rows.map(p => ({ productId: p.id, quantity: p.quantity })), ...(customerId ? { customerId: Number(customerId) } : customerName.trim() ? { customerName: customerName.trim() } : {}), paid: payment, requestId: newRequestId() };
    setBusy(true); setLocked(true); setError('');
    try {
      const result = await post<{ id: number; total: number; paid: number; due: number }>('/sales', pending.current);
      setReceipt(result); setCart({}); setPaid(''); setCustomerId(''); setCustomerName(''); pending.current = null; setLocked(false);
      onSuccess(`Sale #${result.id} recorded. Stock updated.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not record sale.'); if (e instanceof ApiError && e.status >= 400 && e.status < 500) { pending.current = null; setLocked(false); } }
    finally { setBusy(false); }
  };
  return <><div className="checkout-layout"><section className="panel checkout-products"><div className="table-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Find a product to add…" /><span className="count-pill">{products.length}</span></div><ErrorNotice>{inventory.error}</ErrorNotice>{inventory.loading && !inventory.data ? <Loading /> : <div className="pos-grid">{products.filter(p => `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase())).map(p => <button className={`pos-product ${!p.stock ? 'sold-out' : ''}`} disabled={!p.stock || locked} onClick={() => add(p)} key={p.id}><ProductArt emoji={p.emoji} category={p.category} /><h3>{p.name}</h3><div><strong>{money(p.price)}</strong><span>{p.stock ? `${p.stock} left` : 'Out of stock'}</span></div>{!!cart[p.id] && <span className="cart-quantity">{cart[p.id]}</span>}<span className="pos-add"><Plus size={16} /></span></button>)}</div>}</section><form className="panel checkout-cart" onSubmit={submit}><div className="panel-heading"><div><h2>Current sale</h2><p>{rows.reduce((n, p) => n + p.quantity, 0)} items in your basket</p></div><ShoppingBag size={21} /></div><div className="cart-items">{!rows.length ? <Empty title="Ready when you are" message="Choose a product to start this sale." /> : rows.map(p => <div className="cart-row" key={p.id}><ProductArt emoji={p.emoji} category={p.category} small /><div className="cart-row-info"><strong>{p.name}</strong><span>{money(p.price)} / {p.unit}</span><div className="quantity-control"><button type="button" aria-label={`Remove one ${p.name}`} disabled={locked} onClick={() => change(p.id, -1)}><Minus size={12} /></button><span>{p.quantity}</span><button type="button" aria-label={`Add one ${p.name}`} disabled={locked || p.quantity >= p.stock} onClick={() => change(p.id, 1)}><Plus size={12} /></button></div></div><strong>{money(p.price * p.quantity)}</strong></div>)}</div><div className="checkout-form"><Field label="Customer"><select value={customerId} disabled={locked} onChange={e => setCustomerId(e.target.value)}><option value="">Walk-in / enter customer name</option>{customers.data?.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field>{!customerId && <Field label="Customer name" hint="Required when leaving a balance due."><input value={customerName} disabled={locked} onChange={e => setCustomerName(e.target.value)} placeholder="Walk-in customer" maxLength={100} /></Field>}<div className="bill-divider" /><div className="checkout-total"><span>Total</span><strong>{money(total)}</strong></div><Field label="Amount received (৳)" hint="Leave blank for full payment."><div className="input-prefix"><span>৳</span><input type="number" min="0" max={total / 100} step="0.01" placeholder={(total / 100).toFixed(2)} value={paid} disabled={locked} onChange={e => setPaid(e.target.value)} /></div></Field><div className="due-line"><span>Customer balance due</span><strong>{money(Math.max(total - payment, 0))}</strong></div><ErrorNotice>{error}</ErrorNotice>{locked && error && <p className="form-note">Retry sends the same sale safely. Check recent activity before starting a replacement sale.</p>}<SubmitButton busy={busy} disabled={!locked && invalid} className="button button-primary checkout-submit"><CheckCircle2 size={18} />{locked ? 'Retry this sale' : 'Confirm sale'}</SubmitButton><p className="checkout-footnote"><Check size={12} />Stock updates after confirmation</p></div></form></div>{receipt && <Modal title="Another sale, all sorted." eyebrow="SALE COMPLETE" onClose={() => setReceipt(null)}><div className="receipt-success"><CheckCircle2 size={45} /><h3>Sale #{receipt.id}</h3><p>Your sale is saved and stock is updated.</p></div><div className="receipt-lines"><div><span>Total</span><strong>{money(receipt.total)}</strong></div><div><span>Received</span><strong>{money(receipt.paid)}</strong></div><div><span>Balance due</span><strong>{money(receipt.due)}</strong></div></div><button className="button button-primary button-full" onClick={() => setReceipt(null)}>Start another sale <ArrowRight size={17} /></button></Modal>}</>;
}

function CustomersPage({ revision }: { revision: number }) {
  const [localRevision, setLocalRevision] = useState(0);
  const result = useResource<Customer[]>('/customers', revision + localRevision);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const customers = result.data?.filter(c => `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError('');
    const form = new FormData(e.currentTarget);
    try { await post('/customers', Object.fromEntries(form)); setAdding(false); setLocalRevision(n => n + 1); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add customer.'); }
    finally { setBusy(false); }
  };
  return <><div className="inventory-summary"><div><span className="inventory-summary-icon"><Users size={21} /></span><div><strong>{result.data?.length ?? 0}</strong><span>Customers in your book</span></div></div><div><span className="inventory-summary-icon sage"><ShoppingBag size={21} /></span><div><strong>{money(result.data?.reduce((n, c) => n + c.totalSpent, 0) ?? 0)}</strong><span>Total purchases</span></div></div><div><span className="inventory-summary-icon peach"><Wallet size={21} /></span><div><strong>{money(result.data?.reduce((n, c) => n + c.due, 0) ?? 0)}</strong><span>Outstanding balances</span></div></div></div><section className="panel"><div className="table-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search customers…" /><button className="button button-primary button-small" onClick={() => { setError(''); setAdding(true); }}><Plus size={16} />Add customer</button></div><ErrorNotice>{result.error}</ErrorNotice>{result.loading && !result.data ? <Loading /> : !customers.length ? <Empty title="Meet your first regular" message="Add customers here or when recording a sale." /> : <div className="table-scroll"><table><thead><tr><th>Customer</th><th>Contact</th><th>Purchases</th><th>Total spent</th><th>Balance due</th></tr></thead><tbody>{customers.map(c => <tr key={c.id}><td><div className="table-product"><span className="customer-avatar">{c.name.charAt(0).toUpperCase()}</span><div><strong>{c.name}</strong><span>Customer #{c.id}</span></div></div></td><td><div className="contact-cell"><span>{c.phone || '—'}</span>{c.email && <small>{c.email}</small>}</div></td><td>{c.purchases}</td><td className="strong-cell">{money(c.totalSpent)}</td><td><span className={c.due > 0 ? 'balance-due' : 'balance-clear'}>{money(c.due)}</span></td></tr>)}</tbody></table></div>}<div className="table-footer"><span>{customers.length} customers <span className="footer-dot">·</span> Balances are calculated from recorded sales</span></div></section>{adding && <Modal title="A new familiar face." eyebrow="ADD CUSTOMER" onClose={() => setAdding(false)}><form onSubmit={submit} className="form-stack"><Field label="Full name"><input name="name" required minLength={2} maxLength={80} placeholder="Customer name" autoComplete="name" /></Field><Field label="Phone number"><input name="phone" type="tel" maxLength={30} placeholder="01XXXXXXXXX" autoComplete="tel" /></Field><Field label="Email address"><input name="email" type="email" maxLength={200} placeholder="customer@example.com" autoComplete="email" /></Field><Field label="Address"><textarea name="address" maxLength={300} placeholder="Optional address" rows={2} /></Field><ErrorNotice>{error}</ErrorNotice><SubmitButton busy={busy}>Add customer <Plus size={16} /></SubmitButton></form></Modal>}</>;
}

function ShopPage({ shop, loading, error }: { shop: Shop | null; loading: boolean; error: string }) {
  if (loading) return <Loading label="Opening our shop details…" />;
  if (!shop || error) return <ErrorNotice>{error || 'Shop details are unavailable.'}</ErrorNotice>;
  const coordinatesSet = shop.latitude !== null && shop.longitude !== null;
  const destination = coordinatesSet ? `${shop.latitude},${shop.longitude}` : shop.address;
  return <div className="shop-page-grid"><section className="panel shop-details"><div className="shop-profile-art"><Store size={47} strokeWidth={1.4} /><span>🌿</span></div><p className="eyebrow">GOOD THINGS IN YOUR NEIGHBOURHOOD</p><h2>{shop.name}</h2><p className="shop-tagline">{shop.tagline}</p>{shop.demo && <div className="notice notice-info"><CircleHelp size={18} /><span>This is a sample shop profile. Its address, contact and map location need to be replaced with your real shop details.</span></div>}<div className="shop-contact-list"><div><MapPin size={20} /><div><strong>Find us here</strong><p>{shop.address || 'Address not added yet'}</p></div></div><div><Clock3 size={20} /><div><strong>Opening hours</strong><p>{shop.openingHours || 'Hours not added yet'}</p></div></div><div><Store size={20} /><div><strong>Say hello</strong><p>{shop.phone || 'Phone not added yet'}</p>{shop.email && <p>{shop.email}</p>}</div></div></div>{destination && <a className="button button-primary button-full" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`} target="_blank" rel="noopener noreferrer">{shop.demo ? 'View demo location' : 'Get directions'}<ArrowUpRight size={17} /></a>}</section><section className="panel map-panel"><div className="panel-heading"><div><h2>{shop.demo ? 'Demo map location' : 'Just around the corner'}</h2><p>{shop.demo ? 'Example location in Dhaka, Bangladesh' : 'Plan your next visit.'}</p></div><MapPin size={20} /></div>{destination ? <iframe title={shop.demo ? 'Sample shop map, not a verified shop location' : `${shop.name} location`} src={`https://maps.google.com/maps?q=${encodeURIComponent(destination)}&z=14&output=embed`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" allowFullScreen /> : <Empty title="We’ll put you on the map" message="The shop owner needs to configure a location." />}<div className="map-footnote"><MapPin size={15} /><span>{shop.demo ? 'Sample location · configure before real use' : shop.address}</span></div></section></div>;
}

function ProductDialog({ product, user, revision, onClose, onLogin, onSuccess }: { product: Product; user: User | null; revision: number; onClose: () => void; onLogin: () => void; onSuccess: (message: string) => void }) {
  const detail = useResource<Product>(`/products/${product.id}`, revision);
  const details = detail.data ?? product;
  const reviews = useResource<Review[]>(`/products/${product.id}/reviews`, revision);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const ownReview = reviews.data?.find(review => review.userId === user?.id);
  useEffect(() => { if (ownReview) { setRating(ownReview.rating); setBody(ownReview.body); } }, [ownReview?.id]);
  const average = reviews.data?.length ? reviews.data.reduce((n, review) => n + review.rating, 0) / reviews.data.length : 0;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await post(`/products/${product.id}/reviews`, { rating, body }); setEditing(false); if (!ownReview) setBody(''); onSuccess(ownReview ? 'Your review has been updated.' : 'Thank you! Your review is live.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not save review.'); }
    finally { setBusy(false); }
  };
  return <Modal title={details.name} eyebrow={details.category} onClose={onClose} wide><div className="product-detail-top"><ProductArt emoji={details.emoji} category={details.category} /><div><span className={`pill ${details.inStock ? 'pill-green' : 'pill-red'}`}><span />{details.inStock ? 'Available in our shop' : 'Currently out of stock'}</span><p className="product-description">{details.description || 'An everyday essential from our shop.'}</p><div className="detail-price">{money(details.price)}<span> / {details.unit}</span></div><p className="detail-shop-note"><Store size={15} />Visit our shop to purchase this product.</p></div></div><div className="review-section"><div className="review-heading"><div><h3>What our customers say</h3><p>{reviews.data?.length ? <><Star size={14} fill="currentColor" />{average.toFixed(1)} from {reviews.data.length} {reviews.data.length === 1 ? 'review' : 'reviews'}</> : 'Be the first to share your experience.'}</p></div>{user && !editing && <button className="button button-outline button-small" onClick={() => setEditing(true)}>{ownReview ? 'Edit your review' : 'Write a review'}</button>}</div>{!user && <div className="review-signin"><span>Your experience can help your neighbours.</span><button className="text-button" onClick={onLogin}>Sign in to review <ArrowRight size={15} /></button></div>}{user && editing && <form className="review-form" onSubmit={submit}><label className="field"><span>Your rating</span><div className="star-picker" role="group" aria-label="Choose a rating">{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`} aria-pressed={rating === value} onClick={() => setRating(value)}><Star size={27} fill={value <= rating ? 'currentColor' : 'none'} /></button>)}</div></label><Field label="Your review"><textarea value={body} onChange={e => setBody(e.target.value)} required minLength={3} maxLength={1000} rows={3} placeholder="How was this product?" /></Field><ErrorNotice>{error}</ErrorNotice><div className="form-actions"><button className="button button-outline button-small" type="button" onClick={() => setEditing(false)}>Cancel</button><SubmitButton busy={busy} className="button button-primary button-small">{ownReview ? 'Update review' : 'Post review'}</SubmitButton></div></form>}<ErrorNotice>{reviews.error}</ErrorNotice>{reviews.loading && !reviews.data ? <Loading label="Loading reviews…" /> : <div className="reviews-list">{reviews.data?.map(review => <div className="review-item" key={review.id}><div className="review-avatar">{review.author.charAt(0).toUpperCase()}</div><div><div className="review-author"><strong>{review.author}{review.userId === user?.id && <small> (you)</small>}</strong><span>{dayLabel(review.createdAt)}</span></div><div className="review-stars">{[1, 2, 3, 4, 5].map(n => <Star size={12} key={n} fill={n <= review.rating ? 'currentColor' : 'none'} />)}</div><p>{review.body}</p></div></div>)}</div>}</div></Modal>;
}

function AuthDialog({ onClose, onLogin }: { onClose: () => void; onLogin: (result: { token: string; user: User }) => void }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!register || username.trim().length < 3) { setAvailable(null); setChecking(false); return; }
    let cancelled = false;
    setAvailable(null); setChecking(true);
    const timeout = setTimeout(() => api<{ available: boolean }>(`/auth/username?username=${encodeURIComponent(username)}`).then(data => { if (!cancelled) setAvailable(data.available); }).catch(() => { if (!cancelled) setAvailable(null); }).finally(() => { if (!cancelled) setChecking(false); }), 350);
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [username, register]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { const result = await post<{ token: string; user: User }>(register ? '/auth/register' : '/auth/login', register ? { name, username, email, password } : { email, password }); onLogin(result); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };
  const demo = (owner: boolean) => { setEmail(owner ? 'owner@smartshop.local' : 'customer@smartshop.local'); setPassword(owner ? 'SmartShop@123' : 'Customer@123'); setRegister(false); setError(''); };
  return <Modal title={register ? 'Make yourself at home.' : 'Welcome back.'} eyebrow="YOUR EVERYDAY SMARTSHOP" onClose={onClose}><p className="modal-intro">{register ? 'Create a customer account to share reviews and ratings.' : 'Sign in to your shop or customer account.'}</p><form className="form-stack" onSubmit={submit}>{register && <><Field label="Your name"><input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" placeholder="Full name" /></Field><Field label="Username"><input value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" title="Use letters, numbers or underscores" autoComplete="username" placeholder="Choose a unique username" /><small className={available === true ? 'available-text' : available === false ? 'unavailable-text' : ''}>{checking ? 'Checking availability…' : available === true ? '✓ This username is available' : available === false ? 'This username is already taken' : 'Letters, numbers and underscores only.'}</small></Field></>}<Field label="Email address"><input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" maxLength={200} placeholder="you@example.com" /></Field><Field label="Password"><input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={register ? 8 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'At least 8 characters' : 'Your password'} /></Field><ErrorNotice>{error}</ErrorNotice>{register && <p className="form-note">Development build: email and phone verification are not connected yet. Creating an account does not verify your contact details.</p>}<SubmitButton busy={busy} disabled={register && available === false}>{register ? 'Create customer account' : 'Sign in'}<ArrowRight size={17} /></SubmitButton></form><p className="auth-switch">{register ? 'Already have an account?' : 'New around here?'}<button onClick={() => { setRegister(v => !v); setError(''); }}>{register ? 'Sign in' : 'Create an account'}</button></p>{import.meta.env.DEV && !register && <div className="demo-accounts"><p><span className="mini-dot" />LOCAL DEMO ACCOUNTS</p><span>Choose an account to fill in its demo credentials.</span><div><button type="button" onClick={() => demo(true)}><Store size={16} />Shop owner <ArrowUpRight size={14} /></button><button type="button" onClick={() => demo(false)}><Users size={16} />Customer <ArrowUpRight size={14} /></button></div><small>Demo accounts are for this development preview only.</small></div>}</Modal>;
}

function AddProductDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const form = new FormData(e.currentTarget); setBusy(true); setError('');
    const value = Object.fromEntries(form);
    try { await post('/products', { ...value, price: asCents(String(value.price)), cost: asCents(String(value.cost)), stock: Number(value.stock), reorderLevel: Number(value.reorderLevel) }); onSuccess('Product added to your shelves.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not add product.'); }
    finally { setBusy(false); }
  };
  return <Modal title="Something new for your shelves." eyebrow="ADD PRODUCT" onClose={onClose} wide><form className="form-stack" onSubmit={submit}><div className="form-grid"><Field label="Product name"><input name="name" required minLength={2} maxLength={120} placeholder="e.g. Fresh milk" /></Field><Field label="Category"><input name="category" required list="product-categories" maxLength={60} placeholder="Choose or add a category" /><datalist id="product-categories">{['Groceries', 'Dairy', 'Produce', 'Snacks', 'Beverages', 'Bakery', 'Personal care', 'Household', 'Stationery'].map(value => <option key={value} value={value} />)}</datalist></Field><Field label="Selling price (৳)"><input name="price" type="number" min="0" max="1000000" step="0.01" required placeholder="0.00" /></Field><Field label="Cost price (৳)"><input name="cost" type="number" min="0" max="1000000" step="0.01" required placeholder="0.00" /></Field><Field label="Unit"><select name="unit" defaultValue="piece"><option value="piece">Piece</option><option value="kg">Kilogram</option><option value="litre">Litre</option><option value="pack">Pack</option><option value="box">Box</option><option value="dozen">Dozen</option><option value="bottle">Bottle</option><option value="loaf">Loaf</option></select></Field><Field label="Product icon" hint="Temporary icon until image uploads are added."><select name="emoji" defaultValue="📦">{['📦', '🍚', '🥛', '🥚', '🍎', '🍊', '🍞', '🍵', '🧼', '🫙', '🍿', '📒', '👕', '🔌'].map(emoji => <option value={emoji} key={emoji}>{emoji}</option>)}</select></Field><Field label="Opening stock"><input name="stock" type="number" min="0" max="100000" step="1" required defaultValue="0" /></Field><Field label="Low stock alert at" hint="Alert when stock is at or below this level."><input name="reorderLevel" type="number" min="0" max="100000" step="1" required defaultValue="5" /></Field></div><Field label="Description"><textarea name="description" maxLength={2000} rows={3} placeholder="Tell your customers a little about this product…" /></Field><ErrorNotice>{error}</ErrorNotice><div className="form-actions"><button className="button button-outline" type="button" onClick={onClose}>Cancel</button><SubmitButton busy={busy}><Plus size={17} />Add product</SubmitButton></div></form></Modal>;
}

function PurchaseDialog({ revision, onClose, onSuccess }: { revision: number; onClose: () => void; onSuccess: (message: string) => void }) {
  const inventory = useResource<InventoryProduct[]>('/inventory', revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cost, setCost] = useState('');
  const requestId = useRef(newRequestId());
  const [locked, setLocked] = useState(false);
  const pending = useRef<object | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError('');
    if (!pending.current) { const form = new FormData(e.currentTarget); pending.current = { productId: Number(productId), quantity: Number(quantity), unitCost: asCents(cost), reference: String(form.get('reference') || ''), requestId: requestId.current }; }
    setLocked(true);
    try { await post('/purchases', pending.current); onSuccess('Purchase recorded. Your stock is updated.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not record purchase.'); if (err instanceof ApiError && err.status >= 400 && err.status < 500) { pending.current = null; requestId.current = newRequestId(); setLocked(false); } }
    finally { setBusy(false); }
  };
  return <Modal title="Keep the good things coming." eyebrow="RECORD PURCHASE" onClose={onClose}><p className="modal-intro">Record stock received from your supplier. Your stock and average cost will update together.</p><form className="form-stack" onSubmit={submit}><Field label="Product"><select value={productId} required disabled={locked} onChange={e => { setProductId(e.target.value); const p = inventory.data?.find(item => item.id === Number(e.target.value)); if (p) setCost((p.cost / 100).toFixed(2)); }}><option value="">Select a product</option>{inventory.data?.map(p => <option value={p.id} key={p.id}>{p.name} · {p.stock} {p.unit} in stock</option>)}</select></Field><div className="form-grid"><Field label="Quantity received"><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="1" max="100000" step="1" required disabled={locked} /></Field><Field label="Cost per unit (৳)"><input type="number" value={cost} onChange={e => setCost(e.target.value)} min="0" max="1000000" step="0.01" required disabled={locked} /></Field></div><Field label="Supplier / reference"><input name="reference" maxLength={120} placeholder="e.g. Supplier name or invoice number" disabled={locked} /></Field><div className="form-total"><span>Total purchase cost</span><strong>{money((Number(quantity) || 0) * asCents(cost || 0))}</strong></div><ErrorNotice>{error || inventory.error}</ErrorNotice>{locked && error && <p className="form-note">Retry resends the same purchase safely. Check recent activity before recording a replacement.</p>}<SubmitButton busy={busy} disabled={!productId}>{locked ? 'Retry this purchase' : 'Confirm purchase'}<CheckCircle2 size={17} /></SubmitButton></form></Modal>;
}

function ExpenseDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locked, setLocked] = useState(false);
  const pending = useRef<object | null>(null);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError('');
    if (!pending.current) { const form = new FormData(e.currentTarget); pending.current = { title: form.get('title'), amount: asCents(String(form.get('amount'))), date: form.get('date'), requestId: newRequestId() }; }
    setLocked(true);
    try { await post('/expenses', pending.current); onSuccess('Expense recorded in your shop accounts.'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not record expense.'); if (err instanceof ApiError && err.status >= 400 && err.status < 500) { pending.current = null; setLocked(false); } }
    finally { setBusy(false); }
  };
  return <Modal title="The little costs count, too." eyebrow="RECORD EXPENSE" onClose={onClose}><form className="form-stack" onSubmit={submit}><Field label="What was it for?"><input name="title" minLength={2} maxLength={120} placeholder="e.g. Electricity bill" required disabled={locked} /></Field><Field label="Amount (৳)"><input name="amount" type="number" min="0.01" max="1000000" step="0.01" required placeholder="0.00" disabled={locked} /></Field><Field label="Date"><input name="date" type="date" defaultValue={today} required disabled={locked} /></Field><ErrorNotice>{error}</ErrorNotice>{locked && error && <p className="form-note">Retry resends this same expense safely.</p>}<SubmitButton busy={busy}>{locked ? 'Retry this expense' : 'Record expense'}<CheckCircle2 size={17} /></SubmitButton></form></Modal>;
}
