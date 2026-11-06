import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CheckCircle2, Minus, Plus, Search } from 'lucide-react';
import type { Customer, InventoryProduct, SaleInput, SaleResult } from '../shared/types';
import { api, ApiError, post } from './api';
import { asCents, Empty, ErrorNotice, Field, Loading, Modal, money, ProductArt, SubmitButton } from './components';
import { newRequestId } from './requestId';
import { PdfDownloadButton } from './PdfDownloadButton';

export function SalesPage({revision,onSuccess}:{revision:number;onSuccess:(message:string)=>void}){
  const [products,setProducts]=useState<InventoryProduct[]>([]),[customers,setCustomers]=useState<Customer[]>([]);
  const [loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
  const [search,setSearch]=useState(''),[cart,setCart]=useState<Record<number,number>>({});
  const [customerId,setCustomerId]=useState(''),[customerName,setCustomerName]=useState(''),[received,setReceived]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[locked,setLocked]=useState(false);
  const [receipt,setReceipt]=useState<SaleResult|null>(null);
  const pending=useRef<SaleInput|null>(null);
  useEffect(()=>{
    let active=true;setLoadError('');
    Promise.all([api<InventoryProduct[]>('/inventory'),api<Customer[]>('/customers')]).then(([p,c])=>{if(active){setProducts(p);setCustomers(c)}})
      .catch(e=>{if(active)setLoadError(e.message)}).finally(()=>{if(active)setLoading(false)});
    return()=>{active=false};
  },[revision]);
  const selected=customers.find(customer=>customer.id===Number(customerId));
  const rows=products.filter(product=>cart[product.id]).map(product=>({...product,quantity:cart[product.id]}));
  const total=rows.reduce((sum,product)=>sum+product.price*product.quantity,0);
  const previousDue=selected?.due??0;
  const payable=total+previousDue;
  const payment=received===''?payable:asCents(received);
  const towardsEarlier=Math.min(Math.max(payment,0),previousDue);
  const towardsBill=Math.max(0,payment-towardsEarlier);
  const balance=Math.max(payable-payment,0);
  const invalid=!rows.length||total<=0||!Number.isSafeInteger(payment)||payment<0||payment>payable||(towardsBill<total&&!selected&&!customerName.trim());
  function change(product:InventoryProduct,delta:number){if(locked)return;setCart(old=>({...old,[product.id]:Math.min(Math.max((old[product.id]??0)+delta,0),product.stock)}))}
  async function submit(event:FormEvent){
    event.preventDefault();if(busy||(!pending.current&&invalid))return;
    if(!pending.current)pending.current={items:rows.map(product=>({productId:product.id,quantity:product.quantity})),...(selected?{customerId:selected.id}:customerName.trim()?{customerName:customerName.trim()}:{}),paid:towardsBill,previousDuePayment:towardsEarlier,requestId:newRequestId()};
    setBusy(true);setLocked(true);setError('');
    try{
      const result=await post<SaleResult>('/sales',pending.current);setReceipt(result);setCart({});setReceived('');setCustomerId('');setCustomerName('');pending.current=null;setLocked(false);onSuccess(`Sale #${result.id} saved. Stock and customer balance updated.`);
    }catch(e){setError(e instanceof Error?e.message:'Could not save this sale.');if(e instanceof ApiError&&e.status>=400&&e.status<500){pending.current=null;setLocked(false)}}finally{setBusy(false)}
  }
  return <><ErrorNotice>{loadError}</ErrorNotice><div className="checkout-layout">
    <section className="panel checkout-products"><div className="table-toolbar"><div className="search-box"><Search size={18}/><input aria-label="Find a product to add" placeholder="Find a product to add…" value={search} onChange={e=>setSearch(e.target.value)}/></div><span className="count-pill">{products.length}</span></div>
      {loading?<Loading/>:<div className="pos-grid">{products.filter(product=>`${product.name} ${product.category}`.toLowerCase().includes(search.toLowerCase())).map(product=><button className={`pos-product ${product.stock?'':'sold-out'}`} disabled={!product.stock||locked} onClick={()=>change(product,1)} key={product.id}><ProductArt emoji={product.emoji} category={product.category} imageUrl={product.imageUrl}/><h3>{product.name}</h3><div><strong>{money(product.price)}</strong><span>{product.stock?`${product.stock} ${product.unit} left`:'Out of stock'}</span></div>{!!cart[product.id]&&<span className="cart-product-count">{cart[product.id]}</span>}</button>)}</div>}
    </section>
    <form className="panel checkout-cart" onSubmit={submit}><div className="panel-heading"><div><h2>Current sale</h2><p>{rows.reduce((sum,p)=>sum+p.quantity,0)} items in your basket</p></div></div>
      <div className="cart-items">{!rows.length?<Empty title="Ready when you are" message="Choose a product to start this sale."/>:rows.map(product=><div className="cart-row" key={product.id}><ProductArt emoji={product.emoji} category={product.category} imageUrl={product.imageUrl} small/><div className="cart-row-info"><strong>{product.name}</strong><span>{money(product.price)} / {product.unit}</span><div className="quantity-control"><button type="button" disabled={locked} aria-label={`Remove one ${product.name}`} onClick={()=>change(product,-1)}><Minus size={12}/></button><span>{product.quantity}</span><button type="button" disabled={locked||product.quantity>=product.stock} aria-label={`Add one ${product.name}`} onClick={()=>change(product,1)}><Plus size={12}/></button></div></div><strong>{money(product.price*product.quantity)}</strong></div>)}</div>
      <div className="checkout-form"><Field label="Customer"><select value={customerId} disabled={locked} onChange={e=>{setCustomerId(e.target.value);setReceived('')}}><option value="">Walk-in / enter customer name</option>{customers.map(customer=><option key={customer.id} value={customer.id}>{customer.name}{customer.phone?` · ${customer.phone}`:''}{customer.due?` · Due ${money(customer.due)}`:''}</option>)}</select></Field>
        {!selected&&<Field label="Customer name" hint="Required if this bill has an unpaid balance."><input value={customerName} disabled={locked} onChange={e=>setCustomerName(e.target.value)} maxLength={80} placeholder="Walk-in customer"/></Field>}
        {selected&&<div className="customer-checkout-info"><strong>{selected.name}</strong>{selected.phone&&<span>{selected.phone}</span>}{selected.address&&<span>{selected.address}</span>}</div>}
        <div className="bill-divider"/>
        <div className="due-line"><span>Previous balance due</span><strong>{money(previousDue)}</strong></div>
        <div className="due-line"><span>New product bill</span><strong>{money(total)}</strong></div>
        <div className="checkout-total"><span>Total payable</span><strong>{money(payable)}</strong></div>
        <Field label="Amount received (৳)" hint="Leave blank for full payment. Money settles earlier dues first, then this bill."><div className="input-prefix"><span>৳</span><input type="number" min="0" max={payable/100} step="0.01" value={received} disabled={locked} placeholder={(payable/100).toFixed(2)} onChange={e=>setReceived(e.target.value)}/></div></Field>
        {!!previousDue&&<div className="payment-split"><div><span>For previous dues</span><strong>{money(towardsEarlier)}</strong></div><div><span>For this bill</span><strong>{money(towardsBill)}</strong></div></div>}
        <div className="due-line"><span>Customer balance after this sale</span><strong>{money(balance)}</strong></div><ErrorNotice>{error}</ErrorNotice>
        {locked&&error&&<p className="form-note">Retry resends the same sale safely. Check the customer ledger before creating a replacement.</p>}
        <SubmitButton busy={busy} disabled={!locked&&invalid} className="button button-primary checkout-submit"><CheckCircle2 size={18}/>{locked?'Retry this sale':'Confirm sale & payment'}</SubmitButton>
        <p className="checkout-footnote"><Check size={12}/>Due payments reduce balances; only new products count as sales.</p>
      </div>
    </form>
  </div>
  {receipt && <Modal title="Sale and payment saved." eyebrow="SALE COMPLETE" onClose={() => setReceipt(null)}>
    <div className="receipt-success"><CheckCircle2 size={45}/><h3>Sale #{receipt.id}</h3><p>Your stock and customer ledger are up to date.</p></div>
    <div className="receipt-lines"><div><span>New product bill</span><strong>{money(receipt.total)}</strong></div><div><span>Previous dues paid</span><strong>{money(receipt.previousDuePayment ?? 0)}</strong></div><div><span>Paid for this bill</span><strong>{money(receipt.paid)}</strong></div><div><span>Cash received</span><strong>{money(receipt.paid + (receipt.previousDuePayment ?? 0))}</strong></div><div><span>Customer balance</span><strong>{money(receipt.customerBalance ?? receipt.due)}</strong></div></div>
    <div className="form-stack">
      <PdfDownloadButton path={`/sales/${receipt.id}/invoice`} label="Download sales invoice PDF" className="button button-primary button-full" />
      {!!receipt.customerId && !!receipt.previousDueReceiptId && <PdfDownloadButton path={`/customers/${receipt.customerId}/payments/${receipt.previousDueReceiptId}/invoice`} label="Download previous balance receipt" className="button button-outline button-full" />}
      <button type="button" className="button button-outline button-full" onClick={() => setReceipt(null)}>Start another sale</button>
    </div>
  </Modal>}
  <style>{`.customer-checkout-info{background:#f3f7ef;border-radius:10px;padding:12px;display:grid;gap:5px;font-size:13px;color:#53664f}.customer-checkout-info strong{color:#234a36}.payment-split{display:grid;gap:8px;padding:12px;background:#f7f9f2;border-radius:10px;font-size:12px}.payment-split>div{display:flex;justify-content:space-between;gap:12px;color:#52694a}.payment-split strong{white-space:nowrap}`}</style></>;
}
