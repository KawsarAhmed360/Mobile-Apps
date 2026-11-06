import { useState, type FormEvent } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import type { InventoryProduct } from '../shared/types';
import { api, mediaUrl, post } from './api';
import { asCents, ErrorNotice, Field, Modal, SubmitButton } from './components';
import { ProductIconPicker } from './ProductIconPicker';
import { CloudUploadField, type CloudUpload } from './uploads';
import './product-management.css';

const categories = ['Groceries', 'Dairy', 'Produce', 'Snacks', 'Beverages', 'Bakery', 'Personal care', 'Household', 'Stationery'];
const units = ['piece', 'kg', 'litre', 'pack', 'box', 'dozen', 'bottle', 'loaf'];

type ProductDialogActions = { onClose: () => void; onSuccess: (message: string) => void };

export function ProductFormDialog({ product, onClose, onSuccess }: ProductDialogActions & { product?: InventoryProduct }) {
  const [emoji, setEmoji] = useState(product?.emoji || '📦');
  const [photo, setPhoto] = useState<CloudUpload | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || uploading) return;
    const form = new FormData(event.currentTarget);
    const details = {
      name: String(form.get('name')).trim(),
      category: String(form.get('category')).trim(),
      unit: String(form.get('unit')).trim(),
      price: asCents(String(form.get('price'))),
      cost: asCents(String(form.get('cost'))),
      stock: Number(form.get('stock')),
      reorderLevel: Number(form.get('reorderLevel')),
      supplier: String(form.get('supplier')).trim(),
      reference: String(form.get('reference')).trim(),
      description: String(form.get('description')).trim(),
      emoji,
    };
    const photoUpdate = photo ? { uploadId: photo.id } : removePhoto ? { uploadId: null } : {};
    setBusy(true);
    setError('');
    try {
      if (product) {
        const changes = {
          ...Object.fromEntries(Object.entries(details).filter(([key, value]) => value !== product[key as keyof typeof details])),
          ...photoUpdate,
          ...(details.stock !== product.stock ? { expectedStock: product.stock } : {}),
        };
        if (!Object.keys(changes).length) { onClose(); return; }
        await api(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(changes) });
        onSuccess('Product updated.');
      } else {
        await post('/products', { ...details, ...photoUpdate });
        onSuccess('Product added to your shelves.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the product.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={product ? `Edit ${product.name}` : 'Add product'} eyebrow="PRODUCTS & STOCK" onClose={onClose} wide>
    <form className="form-stack" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Product name">
          <input name="name" defaultValue={product?.name} required minLength={2} maxLength={120} placeholder="e.g. Fresh milk" />
        </Field>
        <Field label="Category">
          <input name="category" defaultValue={product?.category} required list="product-categories" maxLength={60} placeholder="Choose or add a category" />
          <datalist id="product-categories">{categories.map(value => <option key={value} value={value} />)}</datalist>
        </Field>
        <Field label="Selling price (৳)">
          <input name="price" defaultValue={product ? (product.price / 100).toFixed(2) : undefined} type="number" min="0" max="1000000" step="0.01" required placeholder="0.00" />
        </Field>
        <Field label="Cost price (৳)">
          <input name="cost" defaultValue={product ? (product.cost / 100).toFixed(2) : undefined} type="number" min="0" max="1000000" step="0.01" required placeholder="0.00" />
        </Field>
        <Field label="Unit">
          <input name="unit" defaultValue={product?.unit ?? 'piece'} list="product-units" required maxLength={30} />
          <datalist id="product-units">{units.map(value => <option key={value} value={value} />)}</datalist>
        </Field>
        <Field label={product ? 'Current stock' : 'Opening stock'} hint={product ? 'A new count creates a stock adjustment.' : undefined}>
          <input name="stock" type="number" min="0" max={product ? 1_000_000 : 100_000} step="1" required defaultValue={product?.stock ?? 0} />
        </Field>
        <Field label="Low stock alert at" hint="Alert when stock is at or below this level.">
          <input name="reorderLevel" type="number" min="0" max="100000" step="1" required defaultValue={product?.reorderLevel ?? 5} />
        </Field>
        <Field label="Supplier">
          <input name="supplier" defaultValue={product?.supplier} maxLength={120} placeholder="Supplier name (optional)" />
        </Field>
        <Field label="Reference">
          <input name="reference" defaultValue={product?.reference} maxLength={120} placeholder="Invoice number or reference (optional)" />
        </Field>
      </div>
      <Field label="Description">
        <textarea name="description" defaultValue={product?.description} maxLength={2000} rows={3} placeholder="Tell your customers a little about this product…" />
      </Field>
      <ProductIconPicker value={emoji} onChange={setEmoji} />
      {product?.imageUrl && !photo && <div className="product-current-photo">
        {!removePhoto && <img src={mediaUrl(product.imageUrl)} alt="Current product" />}
        <button className="button button-outline" type="button" disabled={busy || uploading} onClick={() => setRemovePhoto(!removePhoto)}>
          {removePhoto ? 'Keep current photo' : 'Remove current photo'}
        </button>
      </div>}
      <CloudUploadField purpose="product" value={photo} onChange={setPhoto} onBusyChange={setUploading} disabled={busy} />
      <ErrorNotice>{error}</ErrorNotice>
      <div className="form-actions">
        <button className="button button-outline" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <SubmitButton busy={busy} disabled={uploading}>
          {product ? <><Save size={17} />Save changes</> : <><Plus size={17} />Add product</>}
        </SubmitButton>
      </div>
    </form>
  </Modal>;
}

export function DeleteProductDialog({ product, onClose, onSuccess }: ProductDialogActions & { product: InventoryProduct }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/products/${product.id}`, { method: 'DELETE' });
      onSuccess('Product removed from your shop.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the product.');
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={`Delete ${product.name}?`} eyebrow="PRODUCTS & STOCK" onClose={onClose}>
    <form className="form-stack" onSubmit={remove}>
      <p className="product-delete-copy">The product will be removed from the catalog, stock list and checkout. Past sales stay in your ledger.</p>
      <ErrorNotice>{error}</ErrorNotice>
      <div className="form-actions">
        <button className="button button-outline" type="button" onClick={onClose} disabled={busy}>Cancel</button>
        <SubmitButton busy={busy} className="button product-delete-button"><Trash2 size={17} />Delete product</SubmitButton>
      </div>
    </form>
  </Modal>;
}
