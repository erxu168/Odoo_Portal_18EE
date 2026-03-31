'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Numpad from '@/components/ui/Numpad';
import LocationDropdown from '@/components/ui/LocationDropdown';
import OrdersDashboard from '@/components/purchase/OrdersDashboard';
import FilePicker from "@/components/ui/FilePicker";

// Types
interface Supplier { id: number; name: string; email: string; product_count: number; order_days: string; min_order_value: number; approval_required: number; send_method: string; }
interface GuideItem { id: number; product_id: number; product_name: string; product_uom: string; price: number; price_source: string; category_name: string; }
interface CartSummary { id: number; supplier_id: number; supplier_name: string; item_count: number; total: number; items: any[]; send_method: string; min_order_value: number; approval_required: number; }
interface Order { id: number; supplier_name: string; odoo_po_name: string | null; status: string; total_amount: number; created_at: string; lines?: any[]; delivery_date: string | null; order_note: string; location_id: number; }
interface ReceiptLine { id: number; product_id: number; product_name: string; product_uom: string; ordered_qty: number; received_qty: number | null; difference: number; has_issue: number; issue_type: string | null; issue_notes: string | null; price?: number; subtotal?: number; issue_photo?: string | null; }
interface OdooProduct { id: number; name: string; uom: string; category_name: string; price: number; }

type Tab = 'order' | 'cart' | 'receive' | 'history';
type Screen = 'dashboard' | 'suppliers' | 'guide' | 'cart' | 'review' | 'sent' | 'receive-list' | 'receive-check' | 'receive-issue' | 'history' | 'order-detail' | 'manage' | 'manage-guide';

const LOCATIONS = [
  { id: 32, name: 'SSAM', key: 'SSAM' },
  { id: 22, name: 'GBM38', key: 'GBM38' },
];

export default function PurchasePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('order');
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [locationId, setLocationId] = useState(32);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [guideItems, setGuideItems] = useState<GuideItem[]>([]);
  const [guideSupplierId, setGuideSupplierId] = useState(0);
  const [guideSupplierName, setGuideSupplierName] = useState('');
  const [carts, setCarts] = useState<CartSummary[]>([]);
  const [cartTotal, setCartTotal] = useState({ items: 0, amount: 0 });
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingDeliveries, setPendingDeliveries] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [issueLineId, setIssueLineId] = useState(0);
  const [issueLine, setIssueLine] = useState<ReceiptLine | null>(null);
  const [recvOrder, setRecvOrder] = useState<any>(null);
  const [recvNumpadLineId, setRecvNumpadLineId] = useState<number>(0);
  const [issuePhoto, setIssuePhoto] = useState<string>('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [seedMsg, setSeedMsg] = useState('');
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; cancelLabel?: string; variant: 'primary' | 'danger'; onConfirm: () => void; onCancel?: () => void } | null>(null);
  const [taxRates, setTaxRates] = useState<Record<number, number>>({});

  const [supplierSearch, setSupplierSearch] = useState('');
  const [guideSearch, setGuideSearch] = useState('');
  const [guideCategory, setGuideCategory] = useState('All');
  const [historyFilter, setHistoryFilter] = useState('all');

  const [mgSearch, setMgSearch] = useState('');
  const [mgCategory, setMgCategory] = useState('All');
  const [mgResults, setMgResults] = useState<OdooProduct[]>([]);
  const [mgCategories, setMgCategories] = useState<string[]>([]);
  const [mgSearching, setMgSearching] = useState(false);
  const [mgAdding, setMgAdding] = useState<number>(0);
  const mgDebounce = useRef<NodeJS.Timeout | null>(null);

  const [deliveryDate, setDeliveryDate] = useState('');
  const [orderNote, setOrderNote] = useState('');

  const [numpadOpen, setNumpadOpen] = useState(false);
  const [numpadProduct, setNumpadProduct] = useState<GuideItem | null>(null);
  const [numpadValue, setNumpadValue] = useState('');
  const [cartNumpadItem, setCartNumpadItem] = useState<any>(null);
  const [reviewCart, setReviewCart] = useState<CartSummary | null>(null);

  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user); }).catch(() => {}); }, []);

  const fetchSuppliers = useCallback(async () => { setLoading(true); try { const r = await fetch(`/api/purchase/suppliers?location_id=${locationId}`); const d = await r.json(); setSuppliers(d.suppliers || []); } catch (e) { void e; } finally { setLoading(false); } }, [locationId]);
  const fetchCart = useCallback(async () => { try { const r = await fetch(`/api/purchase/cart?location_id=${locationId}`); const d = await r.json(); setCarts(d.carts || []); setCartTotal({ items: d.total_items || 0, amount: d.total_amount || 0 }); } catch (e) { void e; } }, [locationId]);
  const fetchOrders = useCallback(async () => { try { const r = await fetch(`/api/purchase/orders?location_id=${locationId}&limit=30`); const d = await r.json(); setOrders(d.orders || []); } catch (e) { void e; } }, [locationId]);
  const fetchPending = useCallback(async () => { try { const r = await fetch(`/api/purchase/receive?location_id=${locationId}`); const d = await r.json(); setPendingDeliveries(d.pending || []); } catch (e) { void e; } }, [locationId]);

  const fetchTaxRates = useCallback(async (productIds: number[]) => {
    const uncached = productIds.filter(id => !(id in taxRates));
    if (uncached.length === 0) return;
    try { const r = await fetch(`/api/purchase/tax?product_ids=${uncached.join(',')}`); const d = await r.json(); if (d.taxes) setTaxRates(prev => ({ ...prev, ...d.taxes })); } catch (e) { void e; }
  }, [taxRates]);

  useEffect(() => { fetchSuppliers(); fetchCart(); fetchPending(); }, [fetchSuppliers, fetchCart, fetchPending]);
  useEffect(() => { if (tab === 'history') fetchOrders(); if (tab === 'receive') fetchPending(); }, [locationId, tab, fetchOrders, fetchPending]);
  useEffect(() => { if ((tab === 'cart' || screen === 'review') && carts.length > 0) { const ids = carts.flatMap(c => c.items.map((i: any) => i.product_id)); if (ids.length > 0) fetchTaxRates(ids); } }, [tab, screen, carts, fetchTaxRates]);

  function goHome() { router.push('/'); }

  async function openGuide(supplier: Supplier) {
    setGuideSupplierId(supplier.id); setGuideSupplierName(supplier.name); setGuideSearch(''); setGuideCategory('All'); setScreen('guide');
    try { const r = await fetch(`/api/purchase/guides?supplier_id=${supplier.id}&location_id=${locationId}`); const d = await r.json(); setGuideItems(d.guide?.items || []); const cr = await fetch(`/api/purchase/cart?location_id=${locationId}`); const cd = await cr.json(); const sc = (cd.carts || []).find((c: any) => c.supplier_id === supplier.id); const q: Record<number, number> = {}; if (sc) for (const i of sc.items) q[i.product_id] = i.quantity; setQuantities(q); } catch (e) { void e; setGuideItems([]); }
  }

  function updateCartQty(product: GuideItem | { product_id: number; product_name: string; product_uom: string; price: number }, qty: number, supplierId?: number) {
    const supId = supplierId || guideSupplierId;
    if ('id' in product) setQuantities(prev => ({ ...prev, [product.product_id]: qty }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => { await fetch('/api/purchase/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location_id: locationId, supplier_id: supId, product_id: product.product_id, quantity: qty, product_name: product.product_name, product_uom: product.product_uom, price: product.price }) }); fetchCart(); }, 300);
  }

  function openNumpad(product: GuideItem) { setRecvNumpadLineId(0); setCartNumpadItem(null); setNumpadProduct(product); setNumpadValue(String(quantities[product.product_id] || '')); setNumpadOpen(true); }

  function openCartNumpad(item: any, supplierId: number) {
    setRecvNumpadLineId(0); setCartNumpadItem({ ...item, supplier_id: supplierId });
    setNumpadProduct({ id: 0, product_id: item.product_id, product_name: item.product_name, product_uom: item.product_uom, price: item.price, price_source: '', category_name: '' });
    setNumpadValue(String(item.quantity || '')); setNumpadOpen(true);
  }

  function handleNumpadConfirm(val: number) {
    if (recvNumpadLineId) { updateRecvQty(recvNumpadLineId, val); setRecvNumpadLineId(0); }
    else if (cartNumpadItem) { updateCartQty({ product_id: cartNumpadItem.product_id, product_name: cartNumpadItem.product_name, product_uom: cartNumpadItem.product_uom, price: cartNumpadItem.price }, val, cartNumpadItem.supplier_id); setCartNumpadItem(null); }
    else if (numpadProduct) { updateCartQty(numpadProduct, val); }
    setNumpadOpen(false);
  }

  function changeTab(t: Tab) { setTab(t); if (t === 'order') setScreen('suppliers'); else if (t === 'cart') { setScreen('cart'); fetchCart(); } else if (t === 'receive') { setScreen('receive-list'); fetchPending(); } else if (t === 'history') { setScreen('history'); fetchOrders(); } }

  async function sendOrder(cart: CartSummary) {
    setSending(true);
    try { await fetch('/api/purchase/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart_id: cart.id, delivery_date: deliveryDate || null, order_note: orderNote }) }); await fetchCart(); setDeliveryDate(''); setOrderNote(''); setReviewCart(null); setScreen('sent'); } catch (e) { void e; } finally { setSending(false); }
  }

  async function removeCartItem(cartId: number, productId: number) {
    await fetch('/api/purchase/cart', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart_id: cartId, product_id: productId }) });
    fetchCart();
  }

  async function openReceiveCheck(order: Order) {
    setSelectedOrder(order); setScreen('receive-check');
    try { const r = await fetch(`/api/purchase/receive?order_id=${order.id}`); const d = await r.json(); setReceipt(d.receipt); setReceiptLines(d.receipt?.lines || []); setRecvOrder(d.order || null); } catch (e) { void e; }
  }

  async function updateRecvQty(lineId: number, qty: number) {
    setReceiptLines(prev => prev.map(l => l.id === lineId ? { ...l, received_qty: qty, difference: qty - l.ordered_qty } : l));
    await fetch('/api/purchase/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_line', line_id: lineId, received_qty: qty }) });
  }

  function openIssueReport(line: ReceiptLine) { setIssueLine(line); setIssueLineId(line.id); setIssuePhoto(''); setScreen('receive-issue'); }

  async function submitIssue(issueType: string, notes: string, photo?: string) {
    await fetch('/api/purchase/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_line', line_id: issueLineId, has_issue: 1, issue_type: issueType, issue_notes: notes, issue_photo: photo || null }) });
    setReceiptLines(prev => prev.map(l => l.id === issueLineId ? { ...l, has_issue: 1, issue_type: issueType, issue_notes: notes } : l));
    setIssuePhoto(''); setScreen('receive-check');
  }

  async function confirmReceiptAction(closeOrder: boolean) {
    if (!receipt) return;
    await fetch('/api/purchase/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', receipt_id: receipt.id, close_order: closeOrder }) });
    fetchPending(); setScreen('receive-list');
  }

  async function openOrderDetail(order: Order) { try { const r = await fetch(`/api/purchase/orders?id=${order.id}`); const d = await r.json(); setSelectedOrder(d.order); setScreen('order-detail'); } catch (e) { void e; } }

  async function cancelSelectedOrder() {
    if (!selectedOrder) return;
    await fetch('/api/purchase/orders/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: selectedOrder.id }) });
    fetchOrders(); setScreen('history');
  }

  async function openManageGuide(supplier: Supplier) {
    setGuideSupplierId(supplier.id); setGuideSupplierName(supplier.name); setMgSearch(''); setMgCategory('All'); setMgResults([]); setScreen('manage-guide');
    try { const r = await fetch(`/api/purchase/guides?supplier_id=${supplier.id}&location_id=${locationId}`); const d = await r.json(); setGuideItems(d.guide?.items || []); } catch (e) { void e; setGuideItems([]); }
    try { const r = await fetch('/api/purchase/products?q=&limit=1'); const d = await r.json(); setMgCategories((d.categories || []).map((c: any) => c.name)); } catch (e) { void e; }
  }

  function searchProducts(query: string, category: string) {
    setMgSearch(query); if (mgDebounce.current) clearTimeout(mgDebounce.current);
    if (!query && category === 'All') { setMgResults([]); return; }
    mgDebounce.current = setTimeout(async () => { setMgSearching(true); try { const params = new URLSearchParams(); if (query) params.set('q', query); if (category && category !== 'All') params.set('category', category); params.set('limit', '40'); const r = await fetch(`/api/purchase/products?${params}`); const d = await r.json(); setMgResults(d.products || []); } catch (e) { void e; setMgResults([]); } finally { setMgSearching(false); } }, 400);
  }

  function handleMgCategoryChange(cat: string) {
    setMgCategory(cat);
    if (cat !== 'All') { if (mgDebounce.current) clearTimeout(mgDebounce.current); mgDebounce.current = setTimeout(async () => { setMgSearching(true); try { const params = new URLSearchParams(); if (mgSearch) params.set('q', mgSearch); params.set('category', cat); params.set('limit', '40'); const r = await fetch(`/api/purchase/products?${params}`); const d = await r.json(); setMgResults(d.products || []); } catch (e) { void e; setMgResults([]); } finally { setMgSearching(false); } }, 200); } else if (!mgSearch) { setMgResults([]); } else { searchProducts(mgSearch, 'All'); }
  }

  async function addProductToGuide(product: OdooProduct) {
    setMgAdding(product.id);
    try { await fetch('/api/purchase/guides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplier_id: guideSupplierId, location_id: locationId, product_id: product.id, product_name: product.name, product_uom: product.uom, price: product.price, price_source: 'odoo', category_name: product.category_name }) }); const r = await fetch(`/api/purchase/guides?supplier_id=${guideSupplierId}&location_id=${locationId}`); const d = await r.json(); setGuideItems(d.guide?.items || []); fetchSuppliers(); } catch (e) { void e; } finally { setMgAdding(0); }
  }

  async function removeGuideItemAction(itemId: number) { await fetch(`/api/purchase/guides?item_id=${itemId}`, { method: 'DELETE' }); setGuideItems(prev => prev.filter(i => i.id !== itemId)); fetchSuppliers(); }

  async function runSeed() { setSeedMsg('Seeding...'); try { const r = await fetch('/api/purchase/seed', { method: 'POST' }); const d = await r.json(); setSeedMsg(d.message || 'Done'); fetchSuppliers(); } catch (e: any) { setSeedMsg(`Error: ${e.message}`); } }

  // Tax calc helper
  function calcCartTax(cart: CartSummary) {
    const taxByRate: Record<number, number> = {};
    let net = 0;
    for (const item of cart.items) { const lineNet = item.quantity * item.price; net += lineNet; const rate = taxRates[item.product_id] ?? 0; if (rate > 0) { taxByRate[rate] = (taxByRate[rate] || 0) + lineNet * (rate / 100); } }
    const totalTax = Object.values(taxByRate).reduce((s, v) => s + v, 0);
    return { net, taxByRate, gross: net + totalTax };
  }

  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const locName = LOCATIONS.find(l => l.id === locationId)?.name || 'SSAM';

  const HomeIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
  const BackIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>;
  const WarningIcon = ({ color = '#D97706' }: { color?: string }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"><path d="M12 9v4M12 17h.01"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>;
  const TrashIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>;

  const Header = ({ title, subtitle, showBack, onBack, rightElement }: { title: string; subtitle?: string; showBack?: boolean; onBack?: () => void; rightElement?: React.ReactNode }) => (
    <div className="bg-[#2563EB] px-5 pt-12 pb-3 relative overflow-hidden rounded-b-[28px]">
      <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
      <div className="flex items-center gap-3 relative">
        <button onClick={showBack ? onBack : goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">{showBack ? <BackIcon /> : <HomeIcon />}</button>
        <div className="flex-1 min-w-0"><h1 className="text-[20px] font-bold text-white truncate">{title}</h1>{subtitle && <p className="text-[var(--fs-xs)] text-white/45 mt-0.5">{subtitle}</p>}</div>
        {rightElement}
        {showBack && !rightElement && <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors" title="Dashboard"><HomeIcon /></button>}
      </div>
    </div>
  );

  const locDropdown = <LocationDropdown locations={LOCATIONS} selectedId={locationId} onChange={setLocationId} variant="dark" />;

  const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (<div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-green-500 transition-colors mb-3"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="flex-1 bg-transparent outline-none text-[var(--fs-base)] text-gray-900 placeholder-gray-400" />{value && <button onClick={() => onChange('')} className="text-gray-400 text-[18px]">&times;</button>}</div>);
  const StatusBadge = ({ status }: { status: string }) => { const m: Record<string, [string, string]> = { pending_approval: ['bg-amber-100 text-amber-800', 'Awaiting approval'], approved: ['bg-blue-100 text-blue-800', 'Approved'], sent: ['bg-blue-100 text-blue-800', 'Sent'], received: ['bg-green-100 text-green-800', 'Delivered'], partial: ['bg-amber-100 text-amber-800', 'Partial'], cancelled: ['bg-red-100 text-red-800', 'Cancelled'], draft: ['bg-gray-100 text-gray-700', 'Draft'] }; const [cls, label] = m[status] || ['bg-gray-100 text-gray-700', status]; return <span className={`text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold ${cls}`}>{label}</span>; };

  // ============== SUPPLIER LIST ==============
  const SupplierList = () => {
    const filtered = suppliers.filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()));
    return (<div className="px-4 py-3">
      <SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />
      {loading ? (<div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" /></div>
      ) : filtered.length === 0 && suppliers.length === 0 ? (
        <div className="text-center py-12"><div className="text-4xl mb-3">&#128722;</div><div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No suppliers yet</div><div className="text-[var(--fs-sm)] text-gray-500 mb-4">Set up suppliers and order guides first.</div>{isAdmin && <><button onClick={runSeed} className="w-full max-w-[300px] py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 mb-3">Seed suppliers from Odoo</button>{seedMsg && <p className="text-[12px] text-gray-500">{seedMsg}</p>}</>}</div>
      ) : (<>
        {filtered.map(s => { const days = (() => { try { return JSON.parse(s.order_days); } catch { return []; } })(); const dayStr = days.length > 0 ? days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(' & ') : ''; return (
          <button key={s.id} onClick={() => openGuide(s)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] mb-2.5 active:scale-[0.98] transition-transform text-left">
            <div className="w-14 h-14 rounded-[14px] bg-gray-100 flex items-center justify-center text-[var(--fs-lg)] font-bold text-blue-600 flex-shrink-0">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
            <div className="flex-1 min-w-0"><div className="text-[var(--fs-lg)] font-bold text-gray-900 truncate">{s.name}</div><div className="text-[var(--fs-xs)] text-gray-500 mt-0.5">{s.product_count} products in guide</div>{dayStr && <div className="text-[var(--fs-xs)] font-semibold text-blue-600 mt-1">Orders: {dayStr}</div>}</div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
          </button>); })}
      </>)}
    </div>);
  };

  // ============== ORDER GUIDE ==============
  const OrderGuide = () => {
    const allCategories = ['All', ...Array.from(new Set(guideItems.map(i => i.category_name || 'Other')))];
    const filtered = guideItems.filter(i => { if (guideSearch && !i.product_name.toLowerCase().includes(guideSearch.toLowerCase())) return false; if (guideCategory !== 'All' && (i.category_name || 'Other') !== guideCategory) return false; return true; });
    const categories = Array.from(new Set(filtered.map(i => i.category_name || 'Other')));
    const cartItemCount = Object.values(quantities).filter(q => q > 0).length;
    const cartAmount = guideItems.reduce((sum, i) => sum + (quantities[i.product_id] || 0) * i.price, 0);
    return (<>
      <div className="px-4 py-3 pb-44">
        {(() => { const supplier = suppliers.find(s => s.id === guideSupplierId); const days = (() => { try { return JSON.parse(supplier?.order_days || '[]'); } catch { return []; } })(); if (days.length === 0) return null; const dayStr = days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(' & '); return <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-200 mb-3 text-[var(--fs-sm)] text-blue-800"><span className="text-[14px] mt-0.5">&#128197;</span><span>Order days: <strong>{dayStr}</strong></span></div>; })()}
        <SearchInput value={guideSearch} onChange={setGuideSearch} placeholder="Search products..." />
        <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">{allCategories.map(cat => (<button key={cat} onClick={() => setGuideCategory(cat)} className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 ${guideCategory === cat ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{cat}</button>))}</div>
        {filtered.length === 0 && <div className="text-center py-12"><div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No products found</div></div>}
        {categories.map(cat => (<div key={cat}>
          <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pt-3 pb-2 flex justify-between"><span>{cat}</span><span className="font-mono text-gray-300">{filtered.filter(i => (i.category_name || 'Other') === cat).length}</span></div>
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
            {filtered.filter(i => (i.category_name || 'Other') === cat).map(item => { const qty = quantities[item.product_id] || 0; return (
              <div key={item.id} className={`flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0 ${qty > 0 ? 'bg-green-50 -mx-3.5 px-3.5 rounded-lg mb-1' : ''}`}>
                <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-[var(--fs-lg)] flex-shrink-0">&#128230;</div>
                <div className="flex-1 min-w-0"><div className="text-[var(--fs-xs)] text-gray-400 font-semibold uppercase tracking-wide">{item.product_uom}</div><div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div><div className="text-[var(--fs-sm)] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div></div>
                {qty > 0 ? (<div className="flex items-center flex-shrink-0"><button onClick={() => updateCartQty(item, Math.max(0, qty - 1))} className="w-11 h-11 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[var(--fs-xl)] text-gray-600 active:bg-gray-100">-</button><button onClick={() => openNumpad(item)} className="w-11 h-11 flex items-center justify-center text-[var(--fs-lg)] font-bold font-mono text-gray-900">{qty}</button><button onClick={() => updateCartQty(item, qty + 1)} className="w-11 h-11 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[var(--fs-xl)] text-gray-600 active:bg-gray-100">+</button></div>
                ) : (<button onClick={() => updateCartQty(item, 1)} className="w-11 h-11 rounded-lg bg-green-600 flex items-center justify-center text-white text-[var(--fs-xl)] font-bold shadow-sm active:bg-green-700 flex-shrink-0">+</button>)}
              </div>); })}
          </div>
        </div>))}
      </div>
      {cartItemCount > 0 && (<div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50"><div className="flex justify-between items-center mb-2"><div><div className="text-[18px] font-extrabold font-mono text-gray-900">&euro;{cartAmount.toFixed(2)}</div><div className="text-[var(--fs-xs)] text-gray-500">{cartItemCount} items &bull; shared cart ({locName})</div></div></div><button onClick={() => changeTab('cart')} className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">View cart &rarr;</button></div>)}
    </>);
  };

  // ============== CART ==============
  const CartView = () => {
    return (
    <div className="px-4 py-3 pb-20">
      {carts.length === 0 ? (<div className="text-center py-16"><div className="text-4xl mb-3">&#128722;</div><div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">Cart is empty</div><div className="text-[var(--fs-sm)] text-gray-500">Go to a supplier and add products.</div></div>
      ) : (<>
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-2"><div className="flex items-center gap-3"><span className="text-[16px]">&#128197;</span><div className="flex-1"><div className="text-[var(--fs-base)] font-semibold text-gray-900">Delivery date</div></div><input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="text-[var(--fs-sm)] text-gray-600 border border-gray-200 rounded-lg px-2 py-1" /></div></div>
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3"><div className="text-[13px] font-semibold text-gray-900 mb-1">Order note</div><textarea value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="Add a note for this order..." rows={2} className="w-full text-[var(--fs-sm)] text-gray-600 border border-gray-200 rounded-lg px-3 py-2 resize-none outline-none focus:border-green-500" /></div>
        {carts.map(cart => {
          const { net, taxByRate, gross } = calcCartTax(cart);
          const belowMin = cart.min_order_value > 0 && net < cart.min_order_value;
          return (<div key={cart.id} className="mb-4">
          <div className="flex justify-between items-center py-2"><span className="text-[11px] font-bold tracking-wide uppercase text-gray-400">{cart.supplier_name}</span><div className="flex gap-1.5"><span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-blue-100 text-blue-800">{cart.send_method === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>{cart.approval_required === 1 && <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-amber-100 text-amber-800">Approval required</span>}</div></div>
          {belowMin && (<div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-2 text-[11px] text-amber-800"><span>&#9888;&#65039;</span> Min. order: &euro;{cart.min_order_value.toFixed(2)}. You need &euro;{(cart.min_order_value - net).toFixed(2)} more.</div>)}
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
            {cart.items.map((item: any) => (
              <div key={item.id} className="py-2.5 border-b border-gray-100 last:border-0">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div>
                    <div className="text-[11px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div>
                  </div>
                  <div className="text-right flex-shrink-0"><div className="text-[13px] font-bold font-mono text-gray-900">&euro;{(item.quantity * item.price).toFixed(2)}</div></div>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <div className="flex items-center">
                    <button onClick={() => { if (item.quantity <= 1) { removeCartItem(cart.id, item.product_id); } else { updateCartQty({ product_id: item.product_id, product_name: item.product_name, product_uom: item.product_uom, price: item.price }, item.quantity - 1, cart.supplier_id); } }} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">-</button>
                    <button onClick={() => openCartNumpad(item, cart.supplier_id)} className="w-10 h-8 flex items-center justify-center text-[14px] font-bold font-mono text-gray-900">{item.quantity}</button>
                    <button onClick={() => updateCartQty({ product_id: item.product_id, product_name: item.product_name, product_uom: item.product_uom, price: item.price }, item.quantity + 1, cart.supplier_id)} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">+</button>
                  </div>
                  <button onClick={() => removeCartItem(cart.id, item.product_id)} className="w-8 h-8 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-400 active:bg-red-100"><TrashIcon /></button>
                </div>
              </div>))}
          </div>
          <div className="flex justify-between items-center px-3.5 py-2 mt-2 bg-gray-50 rounded-xl border border-gray-100">
            <span className="text-[12px] text-gray-500">{cart.item_count} items</span>
            <span className="text-[14px] font-bold font-mono text-gray-900">&euro;{net.toFixed(2)}</span>
          </div>
          <button onClick={() => { setReviewCart(cart); setScreen('review'); }} className="w-full mt-2 py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">
            Review order &rarr;
          </button>
        </div>); })}
      </>)}
    </div>);
  };

  // ============== REVIEW ORDER ==============
  const ReviewOrder = () => {
    if (!reviewCart) return null;
    const cart = reviewCart;
    const { net, taxByRate, gross } = calcCartTax(cart);
    const belowMin = cart.min_order_value > 0 && net < cart.min_order_value;

    return (<div className="px-4 py-3 pb-44">
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
        <div className="flex justify-between items-start mb-2">
          <div className="text-[15px] font-bold text-gray-900">{cart.supplier_name}</div>
          <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-blue-100 text-blue-800">{cart.send_method === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
        </div>
        {deliveryDate && <div className="text-[12px] text-gray-500">Delivery: {deliveryDate}</div>}
        {orderNote && <div className="text-[12px] text-gray-500 mt-1 italic">{orderNote}</div>}
        <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100">
          <span className="text-[11px] text-gray-400">{cart.item_count} items &bull; {locName}</span>
          {cart.approval_required === 1 && <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-amber-100 text-amber-800">Approval required</span>}
        </div>
      </div>
      {belowMin && (<div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-3 text-[11px] text-amber-800"><span>&#9888;&#65039;</span> Min. order: &euro;{cart.min_order_value.toFixed(2)}. You need &euro;{(cart.min_order_value - net).toFixed(2)} more.</div>)}
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
        {cart.items.map((item: any) => (
          <div key={item.id} className="flex justify-between items-start py-3 border-b border-gray-100 last:border-0">
            <div className="flex-1 min-w-0 pr-3">
              <div className="text-[13px] font-semibold text-gray-900">{item.product_name}</div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">{item.quantity} {item.product_uom} &times; &euro;{item.price.toFixed(2)}</div>
            </div>
            <div className="text-[13px] font-bold font-mono text-gray-900 flex-shrink-0">&euro;{(item.quantity * item.price).toFixed(2)}</div>
          </div>
        ))}
      </div>
      <div className="bg-gray-50 rounded-xl px-3.5 py-2.5 mt-2 border border-gray-100">
        <div className="flex justify-between text-[12px] text-gray-500"><span>Subtotal (net)</span><span className="font-mono">&euro;{net.toFixed(2)}</span></div>
        {Object.entries(taxByRate).sort(([a],[b]) => Number(a)-Number(b)).map(([r, amt]) => (<div key={r} className="flex justify-between text-[11px] text-gray-400"><span>{r}% MwSt</span><span className="font-mono">&euro;{(amt as number).toFixed(2)}</span></div>))}
        <div className="flex justify-between text-[14px] font-bold text-gray-900 pt-1 border-t border-gray-200 mt-1"><span>Total (gross)</span><span className="font-mono">&euro;{gross.toFixed(2)}</span></div>
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        <button onClick={() => {
          const msg = belowMin
            ? `This order (\u20ac${net.toFixed(2)} net) is below the minimum of \u20ac${cart.min_order_value.toFixed(2)}. Send anyway to ${cart.supplier_name}?`
            : `Send ${cart.item_count} items (\u20ac${gross.toFixed(2)} incl. tax) to ${cart.supplier_name}?`;
          setConfirmDialog({ title: belowMin ? 'Below minimum order' : 'Send order?', message: msg, confirmLabel: belowMin ? 'Send anyway' : 'Yes, send order', variant: 'primary', onConfirm: () => { setConfirmDialog(null); sendOrder(cart); } });
        }} disabled={sending} className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 disabled:opacity-50 active:scale-[0.975] transition-all">
          {sending ? 'Sending...' : `Send to ${cart.supplier_name.split(' ')[0]} \u2192`}
        </button>
        {cart.approval_required === 1 && <p className="text-[11px] text-amber-600 text-center mt-1.5">This order requires manager approval before sending.</p>}
      </div>
    </div>);
  };

  const OrderSent = () => (<div className="px-4 py-3 flex flex-col items-center pt-16"><div className="w-16 h-16 rounded-[18px] bg-green-100 flex items-center justify-center mb-4"><svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg></div><div className="text-[18px] font-bold text-gray-900 mb-2">Order sent!</div><div className="text-[13px] text-gray-500 text-center max-w-[280px] leading-relaxed mb-6">Your order has been submitted.</div><button onClick={() => changeTab('order')} className="w-full max-w-[300px] py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 mb-3">Place another order</button><button onClick={() => changeTab('history')} className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold mb-3">View order history</button><button onClick={goHome} className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold">Back to dashboard</button></div>);

  const HistoryView = () => { const fm: Record<string, string[]> = { all: [], sent: ['sent'], delivered: ['received'], approval: ['pending_approval'], issues: ['partial'] }; const filtered = historyFilter === 'all' ? orders : orders.filter(o => fm[historyFilter]?.includes(o.status)); return (<div className="px-4 py-3"><div className="flex gap-1.5 overflow-x-auto pb-3">{['all', 'sent', 'delivered', 'approval', 'issues'].map(f => (<button key={f} onClick={() => setHistoryFilter(f)} className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 capitalize ${historyFilter === f ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{f}</button>))}</div>{filtered.length === 0 ? (<div className="text-center py-16"><div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No orders yet</div></div>) : (<div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">{filtered.map(order => (<button key={order.id} onClick={() => openOrderDetail(order)} className="w-full flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 text-left active:bg-gray-50"><div className="flex-1 min-w-0"><div className="text-[13px] font-bold text-gray-900">{order.supplier_name}</div><div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`} &bull; {new Date(order.created_at).toLocaleDateString('de-DE')}</div></div><div className="text-right flex-shrink-0"><div className="text-[13px] font-bold font-mono text-gray-900">&euro;{order.total_amount.toFixed(2)}</div><StatusBadge status={order.status} /></div></button>))}</div>)}</div>); };

  const OrderDetail = () => { if (!selectedOrder) return null; const canCancel = ['draft', 'pending_approval', 'approved'].includes(selectedOrder.status); return (<div className="px-4 py-3"><div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3"><div className="flex justify-between items-start mb-3"><div><div className="text-[16px] font-bold text-gray-900">{selectedOrder.supplier_name}</div><div className="text-[12px] text-gray-500 font-mono mt-1">{selectedOrder.odoo_po_name || `#${selectedOrder.id}`}</div></div><StatusBadge status={selectedOrder.status} /></div><div className="text-[12px] text-gray-500 mb-1">Ordered: {new Date(selectedOrder.created_at).toLocaleString('de-DE')}</div>{selectedOrder.delivery_date && <div className="text-[12px] text-gray-500">Delivery: {selectedOrder.delivery_date}</div>}{selectedOrder.order_note && <div className="text-[12px] text-gray-500 mt-1">Note: {selectedOrder.order_note}</div>}</div>{selectedOrder.lines && selectedOrder.lines.length > 0 && (<div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 mb-3">{selectedOrder.lines.map((line: any) => (<div key={line.id} className="flex justify-between py-2.5 border-b border-gray-100 last:border-0 text-[13px]"><div className="text-gray-900">{line.product_name}</div><div className="font-mono text-gray-500">{line.quantity} {line.product_uom} &bull; &euro;{line.subtotal.toFixed(2)}</div></div>))}</div>)}<div className="text-right text-[16px] font-bold font-mono text-gray-900 mb-4">&euro;{selectedOrder.total_amount.toFixed(2)}</div>{canCancel && <button onClick={() => setConfirmDialog({ title: 'Cancel this order?', message: `Are you sure you want to cancel this order to ${selectedOrder.supplier_name}? This cannot be undone.`, confirmLabel: 'Yes, cancel order', variant: 'danger', onConfirm: () => { setConfirmDialog(null); cancelSelectedOrder(); } })} className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100">Cancel order</button>}</div>); };

  const ReceiveList = () => (<div className="px-4 py-3"><div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Pending deliveries</div>{pendingDeliveries.length === 0 ? (<div className="text-center py-16"><div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No pending deliveries</div><div className="text-[var(--fs-sm)] text-gray-500">Sent orders will appear here.</div></div>) : (pendingDeliveries.map(order => (<button key={order.id} onClick={() => openReceiveCheck(order)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5 active:scale-[0.98] transition-transform text-left"><div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">{(order.supplier_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2)}</div><div className="flex-1 min-w-0"><div className="text-[14px] font-bold text-gray-900">{order.supplier_name}</div><div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`}</div></div><span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-amber-100 text-amber-800">{order.status === 'partial' ? 'Partial' : 'Pending'}</span></button>)))}</div>);

  const ReceiveCheck = () => {
    const orderTotal = recvOrder?.total_amount || 0;
    const openRecvNumpad = (line: ReceiptLine) => { setRecvNumpadLineId(line.id); setCartNumpadItem(null); setNumpadProduct({ id: 0, product_id: line.product_id, product_name: line.product_name, product_uom: line.product_uom, price: line.price || 0, price_source: '', category_name: '' }); setNumpadValue(line.received_qty !== null ? String(line.received_qty) : ''); setNumpadOpen(true); };
    return (<div className="px-4 py-3 pb-56">
      {recvOrder && (<div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3"><div className="flex justify-between items-start mb-2"><div><div className="text-[14px] font-bold text-gray-900">{recvOrder.supplier_name}</div><div className="text-[11px] text-gray-500 font-mono mt-0.5">{recvOrder.odoo_po_name || `#${recvOrder.id}`}</div></div><StatusBadge status={recvOrder.status} /></div><div className="text-[11px] text-gray-500">Ordered by <span className="font-semibold text-gray-900">{recvOrder.ordered_by_name}</span></div><div className="text-[11px] text-gray-500">{new Date(recvOrder.created_at).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>{recvOrder.delivery_date && <div className="text-[11px] text-gray-500">Delivery: {recvOrder.delivery_date}</div>}{recvOrder.order_note && <div className="text-[11px] text-gray-500 mt-1 italic">{recvOrder.order_note}</div>}<div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-100"><span className="text-[11px] text-gray-400">{receiptLines.length} items</span><span className="text-[14px] font-bold font-mono text-gray-900">&euro;{orderTotal.toFixed(2)}</span></div></div>)}
      <p className="text-[12px] text-gray-500 mb-3">Enter the quantity you actually received. Leave blank if not delivered yet.</p>
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
        {receiptLines.map(line => { const qty = line.received_qty; const linePrice = line.price || 0; return (
          <div key={line.id} className="py-3 border-b border-gray-100 last:border-0"><div className="flex items-center gap-2.5">
            <div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-gray-900">{line.product_name}</div><div className="text-[11px] text-gray-500 font-mono">Ordered: {line.ordered_qty} {line.product_uom}{linePrice > 0 ? ` \u00b7 \u20ac${linePrice.toFixed(2)}/${line.product_uom}` : ''}</div>{linePrice > 0 && <div className="text-[10px] text-gray-400 font-mono">Subtotal: &euro;{(line.ordered_qty * linePrice).toFixed(2)}</div>}{line.has_issue === 1 && <span className="text-[var(--fs-xs)] px-2.5 py-1 rounded-md font-bold bg-red-100 text-red-800 mt-1 inline-block">{line.issue_type || 'Issue'}</span>}</div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {qty !== null && qty > 0 ? (<div className="flex items-center"><button onClick={() => updateRecvQty(line.id, Math.max(0, (qty || 0) - 1))} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">-</button><button onClick={() => openRecvNumpad(line)} className="w-10 h-8 flex items-center justify-center text-[14px] font-bold font-mono text-gray-900">{qty}</button><button onClick={() => updateRecvQty(line.id, (qty || 0) + 1)} className="w-8 h-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[15px] text-gray-600 active:bg-gray-100">+</button></div>
              ) : (<button onClick={() => openRecvNumpad(line)} className="h-8 px-3 rounded-lg border border-gray-200 bg-white text-[12px] font-semibold text-gray-500 active:bg-gray-100 font-mono">{qty === null ? 'Enter qty' : '0'}</button>)}
              {qty !== null && qty === line.ordered_qty && <span className="text-green-500 text-[15px]">&#10003;</span>}
              {qty !== null && qty !== line.ordered_qty && qty < line.ordered_qty && <span className="text-red-600 text-[11px] font-bold font-mono">{line.difference}</span>}
              <button onClick={() => openIssueReport(line)} className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 active:bg-red-100 ${line.has_issue ? 'bg-red-100' : 'bg-amber-50'}`}><WarningIcon color={line.has_issue ? '#DC2626' : '#D97706'} /></button>
            </div>
          </div></div>); })}
      </div>
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        {isManager ? (<><div className="flex gap-2 mb-2"><button onClick={() => setConfirmDialog({ title: 'Confirm receipt?', message: 'This will update stock quantities in Odoo and close this order. This cannot be undone.', confirmLabel: 'Yes, confirm & close', variant: 'primary', onConfirm: () => { setConfirmDialog(null); confirmReceiptAction(true); } })} className="flex-1 py-3 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700">Confirm &amp; close</button><button onClick={() => setConfirmDialog({ title: 'Keep as backorder?', message: 'Received quantities will be updated in Odoo. The remaining items will stay open for a future delivery.', confirmLabel: 'Yes, keep backorder', variant: 'primary', onConfirm: () => { setConfirmDialog(null); confirmReceiptAction(false); } })} className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Keep as backorder</button></div><p className="text-[11px] text-gray-400 text-center">Confirming will update stock in Odoo.</p></>
        ) : (<p className="text-[12px] text-gray-500 text-center py-2">A manager must confirm receipt to update stock.</p>)}
      </div>
    </div>);
  };

  const ReceiveIssue = () => {
    const [issueType, setIssueType] = useState(issueLine?.issue_type || 'Damaged');
    const [notes, setNotes] = useState(issueLine?.issue_notes || '');
    const [localPhoto, setLocalPhoto] = useState(issuePhoto);
    const types = ['Damaged', 'Wrong item', 'Short delivery', 'Expired', 'Quality', 'Other'];
    function handleCameraCapture(e: React.ChangeEvent<HTMLInputElement>) { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { const base64 = reader.result as string; setLocalPhoto(base64); setIssuePhoto(base64); }; reader.readAsDataURL(file); }
    return (<div className="px-4 py-3">
      <div className="text-[15px] font-bold text-gray-900 mb-1">{issueLine?.product_name}</div>
      <div className="text-[12px] text-gray-500 mb-4">Ordered: {issueLine?.ordered_qty} {issueLine?.product_uom}</div>
      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Photo evidence</label>
      {localPhoto ? (<div className="mb-4 relative"><img src={localPhoto} alt="Issue photo" className="w-full h-48 object-cover rounded-xl border border-gray-200" /><button onClick={() => { setLocalPhoto(''); setIssuePhoto(''); }} className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center text-white text-[14px]">&times;</button><div className="mt-2 text-center"><FilePicker onFile={(file, dataUrl) => handleCameraCapture({ target: { files: [file] } } as any)} accept="image/*" variant="button" label="Retake photo" icon="" className="text-[12px] font-semibold text-green-700 active:opacity-70" /></div></div>
      ) : (<FilePicker onFile={(file, dataUrl) => handleCameraCapture({ target: { files: [file] } } as any)} accept="image/*" label="Tap to take photo" className="w-full mb-4 border-2 border-dashed border-gray-300 rounded-xl p-6 text-center active:bg-gray-50 bg-white" />)}
      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Issue type</label>
      <div className="flex gap-1.5 flex-wrap mb-4">{types.map(t => (<button key={t} onClick={() => setIssueType(t)} className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold ${issueType === t ? 'bg-red-500 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{t}</button>))}</div>
      <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Notes</label>
      <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe the issue..." rows={3} className="w-full text-[13px] border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-green-500 mb-4" />
      <button onClick={() => submitIssue(issueType, notes, localPhoto)} className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30">Submit report</button>
    </div>);
  };

  const ManageScreen = () => (<div className="px-4 py-3"><div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Edit order guides</div>{suppliers.length === 0 ? (<div className="text-center py-12"><div className="text-[var(--fs-sm)] text-gray-500 mb-4">No suppliers yet. Seed from Odoo first.</div>{isAdmin && <button onClick={runSeed} className="py-3 px-6 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30">Seed suppliers from Odoo</button>}{seedMsg && <p className="text-[12px] text-gray-500 mt-3">{seedMsg}</p>}</div>) : (suppliers.map(s => (<button key={s.id} onClick={() => openManageGuide(s)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5 active:scale-[0.98] transition-transform text-left"><div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div><div className="flex-1 min-w-0"><div className="text-[13px] font-bold text-gray-900 truncate">{s.name}</div><div className="text-[11px] text-gray-500">{s.product_count} products &bull; Tap to edit</div></div><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg></button>)))}</div>);

  const ManageGuideScreen = () => {
    const guideProductIds = new Set(guideItems.map(i => i.product_id)); const searchResults = mgResults.filter(p => !guideProductIds.has(p.id)); const guideCats = Array.from(new Set(guideItems.map(i => i.category_name || 'Other'))); const allFilterCats = ['All', ...mgCategories.slice(0, 10)];
    return (<div className="px-4 py-3">
      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-green-500 transition-colors mb-2"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><input type="text" value={mgSearch} onChange={e => searchProducts(e.target.value, mgCategory)} placeholder="Search Odoo products to add..." className="flex-1 bg-transparent outline-none text-[var(--fs-base)] text-gray-900 placeholder-gray-400" />{mgSearch && <button onClick={() => { setMgSearch(''); setMgResults([]); }} className="text-gray-400 text-[18px]">&times;</button>}</div>
      <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">{allFilterCats.map(cat => (<button key={cat} onClick={() => handleMgCategoryChange(cat)} className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 ${mgCategory === cat ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{cat}</button>))}</div>
      {(mgSearch || mgCategory !== 'All') && (<div className="mb-4"><div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">{mgSearching ? 'Searching...' : `${searchResults.length} results`}{searchResults.length > 0 && ' \u2014 tap + to add'}</div>{mgSearching && <div className="flex justify-center py-4"><div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" /></div>}{!mgSearching && searchResults.length > 0 && (<div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">{searchResults.map(product => (<div key={product.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0"><div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center text-[12px] flex-shrink-0">&#128230;</div><div className="flex-1 min-w-0"><div className="text-[13px] font-semibold text-gray-900 truncate">{product.name}</div><div className="text-[11px] text-gray-500 font-mono">{product.uom} &bull; &euro;{product.price.toFixed(2)} &bull; {product.category_name}</div></div><button onClick={() => addProductToGuide(product)} disabled={mgAdding === product.id} className="w-9 h-9 rounded-lg bg-green-500 flex items-center justify-center text-white text-[18px] font-bold shadow-sm active:bg-green-600 flex-shrink-0 disabled:opacity-50">{mgAdding === product.id ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : '+'}</button></div>))}</div>)}{!mgSearching && searchResults.length === 0 && mgResults.length > 0 && (<div className="text-[12px] text-gray-500 text-center py-4">All matching products are already in the guide.</div>)}{!mgSearching && mgResults.length === 0 && (mgSearch || mgCategory !== 'All') && (<div className="text-[12px] text-gray-500 text-center py-4">No products found. Try a different search.</div>)}</div>)}
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">In guide ({guideItems.length})</div>
      {guideItems.length === 0 ? (<div className="bg-white border border-gray-200 rounded-xl p-6 text-center"><div className="text-[var(--fs-sm)] text-gray-500">No products yet. Search above to add products from Odoo.</div></div>) : (guideCats.map(cat => (<div key={cat}><div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-2 pb-1">{cat}</div><div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 mb-2">{guideItems.filter(i => (i.category_name || 'Other') === cat).map(item => (<div key={item.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0"><div className="flex-1 min-w-0"><div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div><div className="text-[11px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div></div><button onClick={() => removeGuideItemAction(item.id)} className="text-[11px] font-semibold text-red-600 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100 active:bg-red-100 flex-shrink-0">Remove</button></div>))}</div></div>)))}
    </div>);
  };

  // ============== RENDER ==============
  return (
    <div className="min-h-screen bg-gray-50">
      {screen === 'guide' ? (<><Header title={guideSupplierName} subtitle={`${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => setScreen('dashboard')} /><OrderGuide /></>
      ) : screen === 'manage' ? (<><Header title="Manage Purchases" subtitle="Guides, suppliers, settings" showBack onBack={() => setScreen('dashboard')} rightElement={locDropdown} /><ManageScreen /></>
      ) : screen === 'manage-guide' ? (<><Header title={guideSupplierName} subtitle={`Edit guide \u2022 ${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => setScreen('manage')} /><ManageGuideScreen /></>
      ) : screen === 'review' ? (<><Header title="Review order" subtitle={reviewCart?.supplier_name} showBack onBack={() => { setScreen('cart'); }} /><ReviewOrder /></>
      ) : screen === 'sent' ? (<><Header title="Purchase" /><OrderSent /></>
      ) : screen === 'order-detail' ? (<><Header title="Order details" showBack onBack={() => { setScreen('history'); }} /><OrderDetail /></>
      ) : screen === 'receive-check' ? (<><Header title={selectedOrder?.supplier_name || 'Receive'} subtitle={selectedOrder?.odoo_po_name || ''} showBack onBack={() => { setScreen('receive-list'); }} /><ReceiveCheck /></>
      ) : screen === 'receive-issue' ? (<><Header title="Report issue" showBack onBack={() => setScreen('receive-check')} /><ReceiveIssue /></>
      ) : screen === 'suppliers' ? (<><Header title="Place Order" subtitle={locName} showBack onBack={() => setScreen('dashboard')} /><SupplierList /></>
      ) : screen === 'cart' ? (<><Header title="Cart" subtitle={`${locName} \u2022 ${cartTotal.items} items`} showBack onBack={() => setScreen('dashboard')} /><CartView /></>
      ) : screen === 'receive-list' ? (<><Header title="Receive" subtitle={locName} showBack onBack={() => setScreen('dashboard')} /><ReceiveList /></>
      ) : screen === 'history' ? (<><Header title="Order History" subtitle={locName} showBack onBack={() => setScreen('dashboard')} /><HistoryView /></>
      ) : (<><Header title="Purchase" subtitle="Order from your suppliers" rightElement={locDropdown} />
        <OrdersDashboard cartItemCount={cartTotal.items} pendingDeliveryCount={pendingDeliveries.length} onNavigate={changeTab} isManager={isManager} onManage={() => setScreen('manage')} locationName={locName} />
      </>)}
      <Numpad open={numpadOpen} value={numpadValue} onChange={setNumpadValue} label={numpadProduct?.product_name} sublabel={numpadProduct?.product_uom} onConfirm={handleNumpadConfirm} onClose={() => { setNumpadOpen(false); setRecvNumpadLineId(0); setCartNumpadItem(null); }} />
      {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmLabel={confirmDialog.confirmLabel} cancelLabel={confirmDialog.cancelLabel} variant={confirmDialog.variant} onConfirm={confirmDialog.onConfirm} onCancel={confirmDialog.onCancel || (() => setConfirmDialog(null))} />}
    </div>
  );
}
