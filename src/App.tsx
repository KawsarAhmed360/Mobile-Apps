import { MediaImage } from './MediaImage';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity as ActivityIcon, ArrowDownLeft, ArrowDownToLine, ArrowRight, ArrowUpRight, BarChart3, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Clock3, CreditCard, FileText, LayoutDashboard, Leaf, LogIn, LogOut, MapPin, Minus, MoreHorizontal, Package, Pencil, Plus, Receipt, Search, ShoppingBag, ShoppingBasket, ShoppingCart, SlidersHorizontal, Sparkles, Star, Store, TrendingUp, Trash2, Users, Wallet, X } from 'lucide-react';
import type { Activity, AuthResponse, Customer, Dashboard, InventoryProduct, Product, Review, Shop, User } from '../shared/types';
import { ApiError, api, hasAccessToken, post, setAccessToken, setAuthSession, signOutSession, subscribeToChanges } from './api';
import { AuthDialog } from './AuthDialog';
import { AccountPanel } from './AccountPanel';
import ConnectionPanel from './ConnectionPanel';
import { newRequestId } from './requestId';
import { SalesPage } from './SalesPage';
import { ShopSettings } from './ShopSettings';
import { CustomersPage } from './CustomerLedger';
import { StockAlerts } from './StockAlerts';
import { StaffAccess } from './StaffAccess';
import { ProductComments } from './community';
import { DeleteProductDialog, ProductFormDialog } from './ProductFormDialog';
import { PdfDownloadButton } from './PdfDownloadButton';
import { ReportsDialog } from './ReportsDialog';
import { asCents, dayLabel, Empty, ErrorNotice, Field, Loading, Modal, money, ProductArt, SubmitButton } from './components';

type Page = 'dashboard' | 'inventory' | 'sales' | 'customers' | 'catalog' | 'shop' | 'settings';
type Dialog = 'login' | 'product' | 'product-edit' | 'product-delete' | 'purchase' | 'expense' | 'reports' | 'account' | 'connection' | null;
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
  { id: 'settings' as Page, label: 'Shop settings', icon: SlidersHorizontal },
];

const pageTitles: Record<Page, { title: string; subtitle: string }> = {
  dashboard: { title: 'A good day to grow.', subtitle: 'Here’s what’s happening in your shop today.' },
  inventory: { title: 'Everything in its place.', subtitle: 'Your products, prices and stock. All together.' },
  sales: { title: 'Let’s make a sale.', subtitle: 'A simple checkout. Stock takes care of itself.' },
  customers: { title: 'Know your regulars.', subtitle: 'Keep track of your customers and their balances.' },
  catalog: { title: 'Good things, close to home.', subtitle: 'Explore what’s available at your neighbourhood shop.' },
  settings: { title: 'Make your shop your own.', subtitle: 'Update your owner information, shop contact and location.' },
  shop: { title: 'Your neighbourhood shop.', subtitle: 'A little closer. A little more convenient.' },
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>('catalog');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [managedProduct, setManagedProduct] = useState<InventoryProduct | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [revision, setRevision] = useState(0);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const shop = useResource<Shop>('/shop', revision);
  const staff = user?.role === 'owner' || user?.role === 'staff';
  const ownerView = !!staff && !['catalog', 'shop'].includes(page);
  const managementNavigation = ownerNavigation.filter(item => item.id !== 'settings' || user?.role === 'owner');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const notify = useCallback((message: string) => { setToast(message); refresh(); }, [refresh]);
  useEffect(() => subscribeToChanges(refresh), [refresh]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timeout); }, [toast]);
  const onLogin = (result: AuthResponse) => {
    setAuthSession(result);
    setUser(result.user);
    setDialog(null);
    if (result.user.role === 'owner' || result.user.role === 'staff') setPage('dashboard');
    notify(`Welcome, ${result.user.name.split(' ')[0]}!`);
  };
  const logout = async () => { try { await signOutSession(); } catch { /* Device sign-out still works while offline. */ } setUser(null); setDialog(null); setPage('catalog'); setSearch(''); notify('You have signed out.'); };
  const restoredOnce = useRef(false);
  useEffect(() => {
    let active = true;
    let restoreSequence = 0;
    const restore = () => {
      const sequence = ++restoreSequence;
      if (!hasAccessToken()) { setUser(null); setPage(current => ['catalog','shop'].includes(current) ? current : 'catalog'); return; }
      api<User>('/auth/me').then(value => {
        if (!active || sequence !== restoreSequence || !hasAccessToken()) return;
        const canManage = value.role === 'owner' || value.role === 'staff';
        const firstRestore = !restoredOnce.current;
        restoredOnce.current = true;
        setUser(value);
        setPage(current => !canManage && !['catalog','shop'].includes(current) ? 'catalog' : firstRestore && canManage ? 'dashboard' : current);
      }).catch(error => {
        if (active && sequence === restoreSequence && error instanceof ApiError && error.status === 401) { setAccessToken(null); setUser(null); setPage('catalog'); }
      });
    };
    restore();
    window.addEventListener('smartshop-session-changed', restore);
    window.addEventListener('online', restore);
    return () => { active = false; window.removeEventListener('smartshop-session-changed', restore); window.removeEventListener('online', restore); };
  }, [revision]);
  useEffect(() => {
    const changed = () => { restoredOnce.current = false; setUser(null); setPage('catalog'); setSearch(''); setDialog(null); setSelectedProduct(null); refresh(); };
    window.addEventListener('smartshop-api-changed', changed);
    return () => window.removeEventListener('smartshop-api-changed', changed);
  }, [refresh]);
  const navigate = (next: Page) => { setPage(next); setSearch(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }).format(new Date());

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate(staff ? 'dashboard' : 'catalog')} aria-label="SmartShop home"><span className="brand-icon"><ShoppingBag size={25} strokeWidth={1.8} /><span /></span><span>smart<span className="brand-light">shop</span><small>YOUR SHOP. SIMPLIFIED.</small></span></button>
      <div className="shop-identity"><div className="shop-avatar"><Store size={20} /></div><div><strong>{shop.data?.name || 'SmartShop'}</strong><span>Single-shop workspace</span></div><span className="status-dot" /></div>
      <p className="nav-section">{ownerView ? 'MANAGE YOUR SHOP' : 'DISCOVER YOUR SHOP'}</p>
      <nav aria-label="Main navigation">{(ownerView ? managementNavigation : [{ id: 'catalog' as Page, label: 'Shop products', icon: ShoppingBasket }, { id: 'shop' as Page, label: 'Visit our shop', icon: MapPin }]).map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}><item.icon size={20} /><span>{item.label}</span>{page === item.id && <span className="nav-active-dot" />}</button>)}</nav>
      {ownerView && <div className="sidebar-secondary"><p className="nav-section">A DIFFERENT PERSPECTIVE</p><button className="nav-item" onClick={() => navigate('catalog')}><Store size={20} /><span>Customer storefront</span><ArrowUpRight size={15} /></button></div>}
      {!ownerView && staff && <div className="sidebar-secondary"><button className="nav-item" onClick={() => navigate('dashboard')}><LayoutDashboard size={20} /><span>Back to dashboard</span><ArrowRight size={15} /></button></div>}
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><Leaf size={22} /></div><strong>A little smarter, every day.</strong><p>One place for your products, people and everyday numbers.</p></div>{user ? <div className="account"><span className="account-avatar">{user.avatarUrl ? <MediaImage src={user.avatarUrl} alt="Your profile" className="account-photo"/> : user.name.charAt(0).toUpperCase()}</span><div><strong>{user.name}</strong><span>{user.role === 'owner' ? 'Shop owner' : user.role === 'staff' ? 'Team member' : 'Customer'}</span></div><button className="icon-button" aria-label="Sign out" onClick={logout}><LogOut size={18} /></button></div> : <button className="button button-primary login-sidebar" onClick={() => setDialog('login')}><LogIn size={17} /> Sign in</button>}</div>
    </aside>

    <div className="main-column">
      <div className="preview-banner"><span className="preview-dot" /><span>Development preview <span className="banner-separator">·</span> {shop.data?.demo ? 'Sample shop information' : 'Your connected shop'}</span><span className="preview-right">SmartShop on your Mac <Sparkles size={12} /></span></div>
      <header className="topbar"><div className="mobile-brand"><ShoppingBag size={22} /><strong>smart<span>shop</span></strong></div><div className="breadcrumb"><span>{ownerView ? 'Workspace' : 'Our shop'}</span><ChevronRight size={14} /><strong>{ownerView ? ownerNavigation.find(n => n.id === page)?.label : page === 'shop' ? 'Location & details' : 'Products'}</strong></div><div className="topbar-actions">{staff && <StockAlerts revision={revision} onOpenStock={()=>navigate('inventory')} />}<button className="icon-button" aria-label="Shop connection settings" onClick={()=>setDialog('connection')}><SlidersHorizontal size={18}/></button><span className="date-label"><Clock3 size={15} />{today}</span>{ownerView && <button className="icon-button storefront-switch" aria-label="Open customer storefront" title="Customer storefront" onClick={() => navigate('catalog')}><Store size={19} /></button>}{user ? <button className="topbar-account" aria-label={`Your account: ${user.name}`} onClick={()=>setDialog('account')}>{user.avatarUrl ? <MediaImage src={user.avatarUrl} alt="Your profile" className="account-photo"/> : user.name.charAt(0).toUpperCase()}</button> : <button className="button button-small button-outline" onClick={() => setDialog('login')}>Sign in <ArrowRight size={15} /></button>}</div></header>

      <main className={`main-content ${page === 'sales' ? 'checkout-main' : ''}`}>
        <div className="page-heading">
          <div><p className="eyebrow"><span />{ownerView ? 'YOUR BUSINESS, AT A GLANCE' : 'WELCOME TO SMARTSHOP'}</p><h1>{pageTitles[page].title}</h1><p className="page-subtitle">{pageTitles[page].subtitle}</p></div>
          <div className="page-actions">
            {ownerView && (page === 'dashboard' || page === 'inventory' || page === 'sales') && <button className="button button-outline" onClick={() => setDialog('reports')}><FileText size={17} /> Reports & PDFs</button>}
            {ownerView && page === 'dashboard' && <><button className="button button-outline" onClick={() => setDialog('expense')}><Plus size={17} /> Add expense</button><button className="button button-primary" onClick={() => navigate('sales')}><Plus size={18} /> New sale</button></>}
            {page === 'inventory' && <><button className="button button-outline" onClick={() => setDialog('purchase')}><ArrowDownToLine size={17} /> Add purchase</button><button className="button button-primary" onClick={() => setDialog('product')}><Plus size={18} /> Add product</button></>}
            {!ownerView && staff && <button className="button button-outline mobile-dashboard-link" onClick={() => navigate('dashboard')}><LayoutDashboard size={17} /> Dashboard</button>}
          </div>
        </div>

        <AnimatePresence mode="wait"><motion.div key={page} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.18 }}>
          {page === 'dashboard' && staff && <DashboardPage revision={revision} onSale={() => navigate('sales')} onPurchase={() => setDialog('purchase')} />}
          {page === 'inventory' && staff && <InventoryPage revision={revision} search={search} setSearch={setSearch} onAdd={() => setDialog('product')} onPurchase={() => setDialog('purchase')} onSelect={setSelectedProduct} onEdit={user?.role === 'owner' ? product => { setManagedProduct(product); setDialog('product-edit'); } : undefined} onDelete={user?.role === 'owner' ? product => { setManagedProduct(product); setDialog('product-delete'); } : undefined} />}
          {page === 'sales' && staff && <SalesPage revision={revision} onSuccess={notify} />}
          {page === 'customers' && staff && <CustomersPage revision={revision} onChange={refresh} onSuccess={notify} />}
          {page === 'catalog' && <CatalogPage revision={revision} search={search} setSearch={setSearch} onSelect={setSelectedProduct} onShop={() => navigate('shop')} />}
          {page === 'settings' && user?.role === 'owner' && <><ShopSettings onUserUpdate={setUser} onSaved={()=>notify('Shop information updated.')} /><StaffAccess revision={revision} onSaved={refresh}/></>}
          {page === 'shop' && <ShopPage shop={shop.data} loading={shop.loading} error={shop.error} />}
        </motion.div></AnimatePresence>
        <footer className="page-footer"><span><Leaf size={13} /> Made for everyday business.</span><span>SmartShop <span className="footer-dot">·</span> Android development preview</span></footer>
      </main>
    </div>

    <nav className="mobile-nav" aria-label="Mobile navigation">{(ownerView ? managementNavigation : [{ id: 'catalog' as Page, label: 'Products', icon: ShoppingBasket }, { id: 'shop' as Page, label: 'Our shop', icon: MapPin }]).map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={21} /><span>{item.label === 'Products & stock' ? 'Stock' : item.label}</span></button>)}{!ownerView && <button onClick={() => user ? logout() : setDialog('login')}>{user ? <LogOut size={21} /> : <LogIn size={21} />}<span>{user ? 'Sign out' : 'Sign in'}</span></button>}</nav>

    {dialog === 'connection' && <ConnectionPanel onClose={()=>setDialog(null)} onSaved={()=>window.location.reload()} />}
    {dialog === 'account' && user && <AccountPanel user={user} onUpdate={setUser} onClose={()=>setDialog(null)} onSignOut={logout} onActivated={onLogin} />}
    {dialog === 'login' && <AuthDialog onClose={() => setDialog(null)} onLogin={onLogin} />}
    {dialog === 'product' && staff && <ProductFormDialog onClose={() => setDialog(null)} onSuccess={message => { setDialog(null); notify(message); }} />}
    {dialog === 'product-edit' && user?.role === 'owner' && managedProduct && <ProductFormDialog key={managedProduct.id} product={managedProduct} onClose={() => setDialog(null)} onSuccess={message => { setDialog(null); notify(message); }} />}
    {dialog === 'product-delete' && user?.role === 'owner' && managedProduct && <DeleteProductDialog product={managedProduct} onClose={() => setDialog(null)} onSuccess={message => { setDialog(null); notify(message); }} />}
    {dialog === 'purchase' && staff && <PurchaseDialog revision={revision} onClose={() => setDialog(null)} onSuccess={notify} />}
    {dialog === 'expense' && staff && <ExpenseDialog onClose={() => setDialog(null)} onSuccess={message => { setDialog(null); notify(message); }} />}
    {dialog === 'reports' && staff && <ReportsDialog onClose={() => setDialog(null)} />}
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
    <section className="panel stock-panel"><div className="panel-heading"><div><h2>Needs a little attention</h2><p>Keep your shelves ready.</p></div><span className="count-pill orange">{data.lowStock.length}</span></div><div className="low-stock-intro"><Package size={16} /><span>At or below your reorder level</span></div><div className="low-stock-list">{data.lowStock.length === 0 ? <Empty title="Your shelves look good" message="No products need restocking right now." /> : data.lowStock.slice(0, 4).map(product => <div className="stock-row" key={product.id}><ProductArt emoji={product.emoji} category={product.category} imageUrl={product.imageUrl} small /><div><strong>{product.name}</strong><span>{product.category}</span></div><span className={`stock-badge ${product.stock === 0 ? 'out' : ''}`}>{product.stock === 0 ? 'Out of stock' : `${product.stock} ${product.unit} left`}</span></div>)}</div><button className="text-button stock-action" onClick={onPurchase}>Record a purchase <ArrowRight size={16} /></button></section></div>
    <div className="dashboard-bottom"><section className="panel activity-panel"><div className="panel-heading"><div><h2>The latest in your shop</h2><p>Your recent transactions.</p></div><span className="subtle-icon"><ActivityIcon size={19} /></span></div>{activity.error && <ErrorNotice>{activity.error}</ErrorNotice>}{activity.loading && !activity.data ? <Loading label="Loading activity…" /> : !activity.data?.length ? <Empty title="A fresh start" message="Your sales, purchases and expenses will appear here." /> : <div className="activity-list">{activity.data.slice(0, 5).map(item => <div className="activity-row" key={`${item.type}-${item.id}`}><span className={`activity-symbol ${item.type === 'sale' ? 'green' : item.type === 'purchase' ? 'blue' : 'orange'}`}>{item.type === 'sale' ? <ArrowUpRight size={19} /> : item.type === 'purchase' ? <ArrowDownLeft size={19} /> : <Receipt size={19} />}</span><div><strong>{item.title}</strong><span>{item.type === 'sale' ? 'Sale recorded' : item.type === 'purchase' ? 'Stock replenished' : item.type === 'payment' ? 'Due payment received' : 'Expense recorded'}</span></div><div className="activity-amount"><strong>{money(item.amount)}</strong><span>{dayLabel(item.createdAt)}</span></div></div>)}</div>}</section><section className="daily-note"><span className="daily-note-icon"><Leaf size={28} /></span><p className="eyebrow">SMALL DETAILS. BIG DIFFERENCE.</p><h2>Your numbers,<br />working for you.</h2><p>You’ve collected <strong>{money(data.cashCollected)}</strong> today from new bills and earlier dues. Collections and sales revenue are tracked separately.</p><div className="note-balance"><span>Total customer dues</span><strong>{money(data.dues)}</strong></div><button className="button button-dark" onClick={onSale}>Record your next sale <ArrowRight size={17} /></button></section></div>
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
    <ErrorNotice>{result.error}</ErrorNotice>{result.loading && !result.data ? <Loading label="Finding your favourites…" /> : result.data?.items.length ? <div className="product-grid">{result.data.items.map((product, i) => <motion.button className="product-card" key={product.id} onClick={() => onSelect(product)} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.18) }}><div className="product-image-wrap"><ProductArt emoji={product.emoji} category={product.category} imageUrl={product.imageUrl} /><span className={`availability ${product.inStock ? '' : 'unavailable'}`}><span />{product.inStock ? 'In stock' : 'Out of stock'}</span><span className="product-open"><ArrowUpRight size={18} /></span></div><div className="product-info"><span className="product-category">{product.category}</span><h3>{product.name}</h3><div className="product-bottom"><strong>{money(product.price)}<small> / {product.unit}</small></strong><span className="product-rating"><Star size={13} fill={product.reviewCount ? 'currentColor' : 'none'} />{product.reviewCount ? product.averageRating.toFixed(1) : 'New'}<small>{product.reviewCount > 0 && `(${product.reviewCount})`}</small></span></div></div></motion.button>)}</div> : <Empty title="No products found" message="Try a different search or category." />}
    {result.data && result.data.pages > 1 && <div className="pagination"><span>Page {page} of {result.data.pages}</span><div><button className="button button-small button-outline" disabled={page <= 1} onClick={() => setPage(n => n - 1)}><ChevronLeft size={16} /> Previous</button><button className="button button-small button-outline" disabled={page >= result.data.pages} onClick={() => setPage(n => n + 1)}>Next <ChevronRight size={16} /></button></div></div>}
  </>;
}

function InventoryPage({ revision, search, setSearch, onAdd, onPurchase, onSelect, onEdit, onDelete }: { onEdit?: (product: InventoryProduct) => void; onDelete?: (product: InventoryProduct) => void; revision: number; search: string; setSearch: (value: string) => void; onAdd: () => void; onPurchase: () => void; onSelect: (product: Product) => void }) {
  const result = useResource<InventoryProduct[]>('/inventory', revision);
  const [lowOnly, setLowOnly] = useState(false);
  const items = result.data?.filter(p => `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase()) && (!lowOnly || p.stock <= p.reorderLevel)) ?? [];
  return <><div className="inventory-summary"><div><span className="inventory-summary-icon"><Package size={21} /></span><div><strong>{result.data?.length ?? 0}</strong><span>Products in your shop</span></div></div><div><span className="inventory-summary-icon sage"><Wallet size={21} /></span><div><strong>{money(result.data?.reduce((n, p) => n + p.stock * p.cost, 0) ?? 0)}</strong><span>Stock value at cost</span></div></div><div><span className="inventory-summary-icon peach"><ActivityIcon size={21} /></span><div><strong>{result.data?.filter(p => p.stock <= p.reorderLevel).length ?? 0}</strong><span>Need restocking</span></div></div></div><section className="panel inventory-panel"><div className="table-toolbar"><SearchBox value={search} onChange={setSearch} placeholder="Search products or categories…" /><button className={`button button-outline button-small ${lowOnly ? 'filter-active' : ''}`} onClick={() => setLowOnly(v => !v)} aria-pressed={lowOnly}><SlidersHorizontal size={16} />Low stock {lowOnly && <Check size={14} />}</button></div><ErrorNotice>{result.error}</ErrorNotice>{result.loading && !result.data ? <Loading /> : !items.length ? <Empty title="Your shelves start here" message={search || lowOnly ? 'No products match your filters.' : 'Add a product and give your shop a fresh start.'}>{!search && !lowOnly && <button className="button button-primary" onClick={onAdd}><Plus size={16} /> Add your first product</button>}</Empty> : <div className="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Cost price</th><th>Selling price</th><th>Stock</th><th>Status</th><th>Discussion</th></tr></thead><tbody>{items.map(p => <tr key={p.id}><td><div className="table-product"><ProductArt emoji={p.emoji} category={p.category} imageUrl={p.imageUrl} small /><div><strong>{p.name}</strong><span>Per {p.unit}</span></div></div>{onEdit && <div className="inventory-product-actions"><button type="button" className="text-button" aria-label={`Edit ${p.name}`} onClick={() => onEdit(p)}><Pencil size={15} /> Edit</button><button type="button" className="text-button" aria-label={`Delete ${p.name}`} onClick={() => onDelete?.(p)}><Trash2 size={15} /> Delete</button></div>}</td><td><span className="category-label">{p.category}</span></td><td>{money(p.cost)}</td><td className="strong-cell">{money(p.price)}</td><td>{p.stock} <span className="muted">{p.unit}</span></td><td><span className={`pill ${p.stock === 0 ? 'pill-red' : p.stock <= p.reorderLevel ? 'pill-orange' : 'pill-green'}`}><span />{p.stock === 0 ? 'Out of stock' : p.stock <= p.reorderLevel ? 'Low stock' : 'In stock'}</span></td><td><button className="text-button inventory-discussion-link" aria-label={`View comments for ${p.name}`} onClick={() => onSelect(p)}>View comments <ArrowUpRight size={15} /></button></td></tr>)}</tbody></table></div>}<div className="table-footer"><span>{items.length} products <span className="footer-dot">·</span> Stock updates with every sale and purchase</span><button className="text-button" onClick={onPurchase}>Record purchase <ArrowRight size={15} /></button></div></section></>;
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
  if (detail.error) return <Modal title={product.name} onClose={onClose}><ErrorNotice>{detail.error}</ErrorNotice></Modal>;
  return <Modal title={details.name} eyebrow={details.category} onClose={onClose} wide><div className="product-detail-top"><ProductArt emoji={details.emoji} category={details.category} imageUrl={details.imageUrl} /><div><span className={`pill ${details.inStock ? 'pill-green' : 'pill-red'}`}><span />{details.inStock ? 'Available in our shop' : 'Currently out of stock'}</span><p className="product-description">{details.description || 'An everyday essential from our shop.'}</p><div className="detail-price">{money(details.price)}<span> / {details.unit}</span></div><p className="detail-shop-note"><Store size={15} />Visit our shop to purchase this product.</p></div></div><div className="review-section"><div className="review-heading"><div><h3>What our customers say</h3><p>{reviews.data?.length ? <><Star size={14} fill="currentColor" />{average.toFixed(1)} from {reviews.data.length} {reviews.data.length === 1 ? 'review' : 'reviews'}</> : 'Be the first to share your experience.'}</p></div>{user && !editing && <button className="button button-outline button-small" onClick={() => setEditing(true)}>{ownReview ? 'Edit your review' : 'Write a review'}</button>}</div>{!user && <div className="review-signin"><span>Your experience can help your neighbours.</span><button className="text-button" onClick={onLogin}>Sign in to review <ArrowRight size={15} /></button></div>}{user && editing && <form className="review-form" onSubmit={submit}><label className="field"><span>Your rating</span><div className="star-picker" role="group" aria-label="Choose a rating">{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} aria-label={`${value} ${value === 1 ? 'star' : 'stars'}`} aria-pressed={rating === value} onClick={() => setRating(value)}><Star size={27} fill={value <= rating ? 'currentColor' : 'none'} /></button>)}</div></label><Field label="Your review"><textarea value={body} onChange={e => setBody(e.target.value)} required minLength={3} maxLength={1000} rows={3} placeholder="How was this product?" /></Field><ErrorNotice>{error}</ErrorNotice><div className="form-actions"><button className="button button-outline button-small" type="button" onClick={() => setEditing(false)}>Cancel</button><SubmitButton busy={busy} className="button button-primary button-small">{ownReview ? 'Update review' : 'Post review'}</SubmitButton></div></form>}<ErrorNotice>{reviews.error}</ErrorNotice>{reviews.loading && !reviews.data ? <Loading label="Loading reviews…" /> : <div className="reviews-list">{reviews.data?.map(review => <div className="review-item" key={review.id}><div className="review-avatar">{review.author.charAt(0).toUpperCase()}</div><div><div className="review-author"><strong>{review.author}{review.userId === user?.id && <small> (you)</small>}</strong><span>{dayLabel(review.createdAt)}</span></div><div className="review-stars">{[1, 2, 3, 4, 5].map(n => <Star size={12} key={n} fill={n <= review.rating ? 'currentColor' : 'none'} />)}</div><p>{review.body}</p></div></div>)}</div>}</div><ProductComments productId={product.id} user={user} revision={revision} onLogin={onLogin} onSuccess={onSuccess} /></Modal>;
}

function PurchaseDialog({ revision, onClose, onSuccess }: { revision: number; onClose: () => void; onSuccess: (message: string) => void }) {
  const inventory = useResource<InventoryProduct[]>('/inventory', revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [productId, setProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cost, setCost] = useState('');
  const [receipt, setReceipt] = useState<number | null>(null);
  const requestId = useRef(newRequestId());
  const [locked, setLocked] = useState(false);
  const pending = useRef<object | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setBusy(true); setError('');
    if (!pending.current) {
      const form = new FormData(e.currentTarget);
      const supplier = String(form.get('supplier') || '').trim();
      pending.current = { productId: Number(productId), quantity: Number(quantity), unitCost: asCents(cost), ...(supplier ? { supplier } : {}), reference: String(form.get('reference') || ''), requestId: requestId.current };
    }
    setLocked(true);
    try {
      const result = await post<{ id: number }>('/purchases', pending.current);
      setReceipt(result.id);
      onSuccess('Purchase recorded. Your stock is updated.');
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not record purchase.'); if (err instanceof ApiError && err.status >= 400 && err.status < 500) { pending.current = null; requestId.current = newRequestId(); setLocked(false); } }
    finally { setBusy(false); }
  };
  if (receipt !== null) return <Modal title={`Purchase #${receipt} saved`} eyebrow="PURCHASE COMPLETE" onClose={onClose}>
    <div className="form-stack">
      <p className="modal-intro">The stock and average cost are up to date.</p>
      <PdfDownloadButton path={`/purchases/${receipt}/bill`} label="Download purchase bill PDF" className="button button-primary button-full" />
      <button type="button" className="button button-outline button-full" onClick={onClose}>Done</button>
    </div>
  </Modal>;
  const selected = inventory.data?.find(item => item.id === Number(productId));
  return <Modal title="Keep the good things coming." eyebrow="RECORD PURCHASE" onClose={onClose}>
    <p className="modal-intro">Record stock received from your supplier. Your stock and average cost will update together.</p>
    <form className="form-stack" onSubmit={submit}>
      <Field label="Product"><select value={productId} required disabled={locked} onChange={e => {
        setProductId(e.target.value);
        const product = inventory.data?.find(item => item.id === Number(e.target.value));
        if (product) setCost((product.cost / 100).toFixed(2));
      }}><option value="">Select a product</option>{inventory.data?.map(p => <option value={p.id} key={p.id}>{p.name} · {p.stock} {p.unit} in stock</option>)}</select></Field>
      <div className="form-grid"><Field label="Quantity received"><input type="number" value={quantity} onChange={e => setQuantity(e.target.value)} min="1" max="100000" step="1" required disabled={locked} /></Field><Field label="Cost per unit (৳)"><input type="number" value={cost} onChange={e => setCost(e.target.value)} min="0" max="1000000" step="0.01" required disabled={locked} /></Field></div>
      <Field label="Supplier" hint={selected?.supplier ? `Leave blank to use ${selected.supplier}.` : 'Optional'}><input name="supplier" maxLength={120} placeholder={selected?.supplier || 'Supplier name'} disabled={locked} /></Field>
      <Field label="Reference"><input name="reference" maxLength={120} placeholder="Supplier bill number or reference" disabled={locked} /></Field>
      <div className="form-total"><span>Total purchase cost</span><strong>{money((Number(quantity) || 0) * asCents(cost || 0))}</strong></div>
      <ErrorNotice>{error || inventory.error}</ErrorNotice>
      {locked && error && <p className="form-note">Retry resends the same purchase safely. Check recent activity before recording a replacement.</p>}
      <SubmitButton busy={busy} disabled={!productId}>{locked ? 'Retry this purchase' : 'Confirm purchase'}<CheckCircle2 size={17} /></SubmitButton>
    </form>
  </Modal>;
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
