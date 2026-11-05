import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import './product-icons/fonts.css';

type Icon = { glyph: string; name: string; terms: string; group: string };
const pageSize = 60;

export function ProductIconPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [icons, setIcons] = useState<Icon[]>([]);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [limit, setLimit] = useState(pageSize);

  useEffect(() => {
    if (!open || icons.length || failed) return;
    let active = true;
    import('./product-icons/catalog.json').then(({ default: groups }) => {
      if (!active) return;
      const sorted = [...groups].sort((a, b) => Number(b.name === 'Food & Drink') - Number(a.name === 'Food & Drink'));
      setIcons(sorted.flatMap(category => category.icons.map(([glyph, name, keywords]) => ({
        glyph, name, group: category.name,
        terms: [glyph, name, category.name, keywords].join(' ').normalize('NFKC').toLowerCase(),
      }))));
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [open, icons.length, failed]);

  const groups = useMemo(() => [...new Set(icons.map(icon => icon.group))], [icons]);
  const results = useMemo(() => {
    const words = search.normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
    return icons.filter(icon => (!group || group === icon.group) && words.every(word => icon.terms.includes(word)));
  }, [icons, search, group]);

  return <section className="product-icon-picker" aria-label="Product icon">
    <button type="button" className="button button-outline product-icon-trigger" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <span className="shop-emoji" aria-hidden="true">{value}</span>
      <span>{open ? 'Close icon picker' : 'Choose product icon'}</span>
      <ChevronDown size={17} aria-hidden="true" />
    </button>
    {open && <div className="product-icon-options">
      <label className="product-icon-search">
        <Search size={17} aria-hidden="true" />
        <input type="search" aria-label="Search product icons" placeholder="Search icons, e.g. banana or কলা" value={search}
          onChange={event => { setSearch(event.target.value); setLimit(pageSize); }} />
      </label>
      <select aria-label="Icon category" value={group} onChange={event => { setGroup(event.target.value); setLimit(pageSize); }}>
        <option value="">All icon categories</option>
        {groups.map(name => <option key={name}>{name}</option>)}
      </select>
      {failed ? <button type="button" className="button button-outline" onClick={() => setFailed(false)}>Retry loading icons</button>
        : !icons.length ? <p role="status">Loading icons…</p>
        : <>
          <p role="status">{results.length.toLocaleString()} {results.length === 1 ? 'icon' : 'icons'} found</p>
          <div className="product-icon-grid" role="group" aria-label="Matching icons">
            {results.slice(0, limit).map(icon => <button key={icon.glyph} type="button" aria-label={icon.name} title={icon.name}
              aria-pressed={value === icon.glyph} className="shop-emoji" onClick={() => { onChange(icon.glyph); setOpen(false); }}>{icon.glyph}</button>)}
          </div>
          {results.length > limit && <button type="button" className="button button-outline" onClick={() => setLimit(count => count + pageSize)}>Show more icons</button>}
        </>}
    </div>}
  </section>;
}
