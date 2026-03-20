'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';

// Types
interface Supplier { id: number; name: string; email: string; product_count: number; order_days: string; min_order_value: number; approval_required: number; send_method: string; }
interface GuideItem { id: number; product_id: number; product_name: string; product_uom: string; price: number; price_source: string; category_name: string; }
interface CartSummary { id: number; supplier_id: number; supplier_name: string; item_count: number; total: number; items: any[]; send_method: string; min_order_value: number; approval_required: number; }
interface Order { id: number; supplier_name: string; odoo_po_name: string | null; status: string; total_amount: number; created_at: string; lines?: any[]; delivery_date: string | null; order_note: string; location_id: number; }
interface ReceiptLine { id: number; product_id: number; product_name: string; product_uom: string; ordered_qty: number; received_qty: number | null; difference: number; has_issue: number; issue_type: string | null; issue_notes: string | null; }

type Tab = 'order' | 'cart' | 'receive' | 'history';
type Screen = 'suppliers' | 'guide' | 'cart' | 'sent' | 'receive-list' | 'receive-check' | 'receive-issue' | 'history' | 'order-detail' | 'manage' | 'manage-guide';

const LOCATIONS = [
  { id: 32, name: 'SSAM', key: 'SSAM' },
  { id: 22, name: 'GBM38', key: 'GBM38' },
];

export default function PurchasePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('order');
  const [screen, setScreen] = useState<Screen>('suppliers');
  const [locationId, setLocationId] = useState(32);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Data
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
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [seedMsg, setSeedMsg] = useState('');

  // Search + filter
  const [supplierSearch, setSupplierSearch] = useState('');
  const [guideSearch, setGuideSearch] = useState('');
  const [guideCategory, setGuideCategory] = useState('All');
  const [historyFilter, setHistoryFilter] = useState('all');

  // Cart extras
  const [deliveryDate, setDeliveryDate] = useState('');
  const [orderNote, setOrderNote] = useState('');

  // Numpad
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [numpadProduct, setNumpadProduct] = useState<GuideItem | null>(null);
  const [numpadValue, setNumpadValue] = useState('');

  // Debounce ref
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch user
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user); }).catch(() => {});
  }, []);

  // Fetchers
  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/purchase/suppliers?location_id=${locationId}`);
      const d = await r.json();
      setSuppliers(d.suppliers || []);
    } catch (_e) {}
    finally { setLoading(false); }
  }, [locationId]);

  const fetchCart = useCallback(async () => {
    try {
      const r = await fetch(`/api/purchase/cart?location_id=${locationId}`);
      const d = await r.json();
      setCarts(d.carts || []);
      setCartTotal({ items: d.total_items || 0, amount: d.total_amount || 0 });
    } catch (_e) {}
  }, [locationId]);

  const fetchOrders = useCallback(async () => {
    try {
      const r = await fetch(`/api/purchase/orders?location_id=${locationId}&limit=30`);
      const d = await r.json();
      setOrders(d.orders || []);
    } catch (_e) {}
  }, [locationId]);

  const fetchPending = useCallback(async () => {
    try {
      const r = await fetch(`/api/purchase/receive?location_id=${locationId}`);
      const d = await r.json();
      setPendingDeliveries(d.pending || []);
    } catch (_e) {}
  }, [locationId]);

  useEffect(() => { fetchSuppliers(); fetchCart(); }, [fetchSuppliers, fetchCart]);

  // Refetch on location change
  useEffect(() => {
    if (tab === 'history') fetchOrders();
    if (tab === 'receive') fetchPending();
  }, [locationId, tab, fetchOrders, fetchPending]);

  function goHome() { router.push('/'); }

  async function openGuide(supplier: Supplier) {
    setGuideSupplierId(supplier.id);
    setGuideSupplierName(supplier.name);
    setGuideSearch('');
    setGuideCategory('All');
    setScreen('guide');
    try {
      const r = await fetch(`/api/purchase/guides?supplier_id=${supplier.id}&location_id=${locationId}`);
      const d = await r.json();
      setGuideItems(d.guide?.items || []);
      const cr = await fetch(`/api/purchase/cart?location_id=${locationId}`);
      const cd = await cr.json();
      const sc = (cd.carts || []).find((c: any) => c.supplier_id === supplier.id);
      const q: Record<number, number> = {};
      if (sc) for (const i of sc.items) q[i.product_id] = i.quantity;
      setQuantities(q);
    } catch (_e) { setGuideItems([]); }
  }

  // Debounced cart update
  function updateCartQty(product: GuideItem, qty: number) {
    setQuantities(prev => ({ ...prev, [product.product_id]: qty }));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      await fetch('/api/purchase/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId, supplier_id: guideSupplierId,
          product_id: product.product_id, quantity: qty,
          product_name: product.product_name, product_uom: product.product_uom, price: product.price,
        }),
      });
      fetchCart();
    }, 300);
  }

  // Numpad
  function openNumpad(product: GuideItem) {
    setNumpadProduct(product);
    setNumpadValue(String(quantities[product.product_id] || ''));
    setNumpadOpen(true);
  }
  function numpadKey(k: string) {
    if (k === 'del') setNumpadValue(prev => prev.slice(0, -1));
    else if (k === '.' && numpadValue.includes('.')) return;
    else setNumpadValue(prev => prev + k);
  }
  function confirmNumpad() {
    if (numpadProduct) updateCartQty(numpadProduct, parseFloat(numpadValue) || 0);
    setNumpadOpen(false);
  }

  function changeTab(t: Tab) {
    setTab(t);
    if (t === 'order') setScreen('suppliers');
    else if (t === 'cart') { setScreen('cart'); fetchCart(); }
    else if (t === 'receive') { setScreen('receive-list'); fetchPending(); }
    else if (t === 'history') { setScreen('history'); fetchOrders(); }
  }

  // Send order for a single cart
  async function sendOrder(cart: CartSummary) {
    setSending(true);
    try {
      await fetch('/api/purchase/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart_id: cart.id, delivery_date: deliveryDate || null, order_note: orderNote }),
      });
      await fetchCart();
      if (carts.length <= 1) {
        setDeliveryDate('');
        setOrderNote('');
        setScreen('sent');
      }
    } catch (_e) {}
    finally { setSending(false); }
  }

  // Open receive check
  async function openReceiveCheck(order: Order) {
    setSelectedOrder(order);
    setScreen('receive-check');
    try {
      const r = await fetch(`/api/purchase/receive?order_id=${order.id}`);
      const d = await r.json();
      setReceipt(d.receipt);
      setReceiptLines(d.receipt?.lines || []);
    } catch (_e) {}
  }

  // Update receipt line qty
  async function updateRecvQty(lineId: number, qty: number) {
    setReceiptLines(prev => prev.map(l => l.id === lineId ? { ...l, received_qty: qty, difference: qty - l.ordered_qty } : l));
    await fetch('/api/purchase/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_line', line_id: lineId, received_qty: qty }),
    });
  }

  function openIssueReport(line: ReceiptLine) {
    setIssueLine(line);
    setIssueLineId(line.id);
    setScreen('receive-issue');
  }

  async function submitIssue(issueType: string, notes: string) {
    await fetch('/api/purchase/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_line', line_id: issueLineId, has_issue: 1, issue_type: issueType, issue_notes: notes }),
    });
    setReceiptLines(prev => prev.map(l => l.id === issueLineId ? { ...l, has_issue: 1, issue_type: issueType, issue_notes: notes } : l));
    setScreen('receive-check');
  }

  async function confirmReceiptAction(closeOrder: boolean) {
    if (!receipt) return;
    await fetch('/api/purchase/receive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm', receipt_id: receipt.id, close_order: closeOrder }),
    });
    fetchPending();
    setScreen('receive-list');
  }

  async function openOrderDetail(order: Order) {
    try {
      const r = await fetch(`/api/purchase/orders?id=${order.id}`);
      const d = await r.json();
      setSelectedOrder(d.order);
      setScreen('order-detail');
    } catch (_e) {}
  }

  async function cancelSelectedOrder() {
    if (!selectedOrder) return;
    await fetch('/api/purchase/orders/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: selectedOrder.id }),
    });
    fetchOrders();
    setScreen('history');
  }

  async function openManageGuide(supplier: Supplier) {
    setGuideSupplierId(supplier.id);
    setGuideSupplierName(supplier.name);
    setScreen('manage-guide');
    try {
      const r = await fetch(`/api/purchase/guides?supplier_id=${supplier.id}&location_id=${locationId}`);
      const d = await r.json();
      setGuideItems(d.guide?.items || []);
    } catch (_e) { setGuideItems([]); }
  }

  async function removeGuideItemAction(itemId: number) {
    await fetch(`/api/purchase/guides?item_id=${itemId}`, { method: 'DELETE' });
    setGuideItems(prev => prev.filter(i => i.id !== itemId));
    fetchSuppliers();
  }

  async function runSeed() {
    setSeedMsg('Seeding...');
    try {
      const r = await fetch('/api/purchase/seed', { method: 'POST' });
      const d = await r.json();
      setSeedMsg(d.message || 'Done');
      fetchSuppliers();
    } catch (e: any) { setSeedMsg(`Error: ${e.message}`); }
  }

  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const locName = LOCATIONS.find(l => l.id === locationId)?.name || 'SSAM';

  // ========== ICONS ==========
  const HomeIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>;
  const BackIcon = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>;

  // ========== HEADER ==========
  const Header = ({ title, subtitle, showBack, onBack }: { title: string; subtitle?: string; showBack?: boolean; onBack?: () => void }) => (
    <div className="bg-[#1A1F2E] px-5 pt-12 pb-0 relative overflow-hidden">
      <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
      <div className="flex items-center gap-3 relative pb-3">
        <button onClick={showBack ? onBack : goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
          {showBack ? <BackIcon /> : <HomeIcon />}
        </button>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold text-white">{title}</h1>
          {subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}
        </div>
        {showBack && <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors" title="Dashboard"><HomeIcon /></button>}
      </div>
    </div>
  );

  const LocationPicker = () => (
    <div className="bg-[#1A1F2E] px-5 pb-3 flex gap-2 relative">
      {LOCATIONS.map(loc => (
        <button key={loc.id} onClick={() => setLocationId(loc.id)} className={`px-4 py-1.5 rounded-full text-[11px] font-bold transition-all ${locationId === loc.id ? 'bg-orange-500 text-white' : 'bg-white/10 text-white/45'}`}>{loc.name}</button>
      ))}
    </div>
  );

  const Tabs = () => (
    <div className="flex gap-1 px-4 py-2.5 bg-white border-b border-gray-200 overflow-x-auto">
      {(['order', 'cart', 'receive', 'history'] as Tab[]).map(t => (
        <button key={t} onClick={() => changeTab(t)} className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap flex-shrink-0 transition-all ${tab === t ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
          {t === 'order' ? 'Order' : t === 'cart' ? `Cart${cartTotal.items > 0 ? ` (${cartTotal.items})` : ''}` : t === 'receive' ? 'Receive' : 'History'}
        </button>
      ))}
    </div>
  );

  const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) => (
    <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3.5 h-11 focus-within:border-orange-400 transition-colors mb-3">
      <svg width="16" height="16" viewBox="0 0 18 18" fill="none" className="text-gray-400 flex-shrink-0"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M12.5 12.5L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="flex-1 bg-transparent outline-none text-[14px] text-[#1F2933] placeholder-gray-400" />
      {value && <button onClick={() => onChange('')} className="text-gray-400 text-[18px]">&times;</button>}
    </div>
  );

  const StatusBadge = ({ status }: { status: string }) => {
    const m: Record<string, [string, string]> = {
      pending_approval: ['bg-amber-100 text-amber-800', 'Awaiting approval'],
      approved: ['bg-blue-100 text-blue-800', 'Approved'],
      sent: ['bg-blue-100 text-blue-800', 'Sent'],
      received: ['bg-green-100 text-green-800', 'Delivered'],
      partial: ['bg-amber-100 text-amber-800', 'Partial'],
      cancelled: ['bg-red-100 text-red-800', 'Cancelled'],
      draft: ['bg-gray-100 text-gray-700', 'Draft'],
    };
    const [cls, label] = m[status] || ['bg-gray-100 text-gray-700', status];
    return <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${cls}`}>{label}</span>;
  };

  // ============== SUPPLIER LIST ==============
  const SupplierList = () => {
    const filtered = suppliers.filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()));
    return (
      <div className="px-4 py-3">
        <SearchInput value={supplierSearch} onChange={setSupplierSearch} placeholder="Search suppliers..." />
        {loading ? (
          <div className="flex justify-center py-12"><div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" /></div>
        ) : filtered.length === 0 && suppliers.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">&#128722;</div>
            <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No suppliers yet</div>
            <div className="text-[13px] text-gray-500 mb-4">Set up suppliers and order guides first.</div>
            {isAdmin && <>
              <button onClick={runSeed} className="w-full max-w-[300px] py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 mb-3">Seed suppliers from Odoo</button>
              {seedMsg && <p className="text-[12px] text-gray-500">{seedMsg}</p>}
            </>}
          </div>
        ) : (
          <>
            {filtered.map(s => {
              const days = (() => { try { return JSON.parse(s.order_days); } catch { return []; } })();
              const dayStr = days.length > 0 ? days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(' & ') : '';
              return (
                <button key={s.id} onClick={() => openGuide(s)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] mb-2.5 active:scale-[0.98] transition-transform text-left">
                  <div className="w-12 h-12 rounded-[14px] bg-[#F1F3F5] flex items-center justify-center text-[16px] font-bold text-blue-600 flex-shrink-0">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] font-bold text-[#1F2933] truncate">{s.name}</div>
                    <div className="text-[11px] text-gray-500 mt-0.5">{s.product_count} products in guide</div>
                    {dayStr && <div className="text-[10px] font-semibold text-blue-600 mt-1">Orders: {dayStr}</div>}
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
                </button>
              );
            })}
            {isManager && <div className="text-center mt-4"><button onClick={() => setScreen('manage')} className="text-[12px] font-semibold text-orange-600 px-4 py-2 rounded-lg bg-orange-50 active:bg-orange-100">Manage guides &amp; settings</button></div>}
          </>
        )}
      </div>
    );
  };

  // ============== ORDER GUIDE ==============
  const OrderGuide = () => {
    const allCategories = ['All', ...Array.from(new Set(guideItems.map(i => i.category_name || 'Other')))];
    const filtered = guideItems.filter(i => {
      if (guideSearch && !i.product_name.toLowerCase().includes(guideSearch.toLowerCase())) return false;
      if (guideCategory !== 'All' && (i.category_name || 'Other') !== guideCategory) return false;
      return true;
    });
    const categories = Array.from(new Set(filtered.map(i => i.category_name || 'Other')));
    const cartItemCount = Object.values(quantities).filter(q => q > 0).length;
    const cartAmount = guideItems.reduce((sum, i) => sum + (quantities[i.product_id] || 0) * i.price, 0);

    return (
      <>
        <div className="px-4 py-3 pb-28">
          {(() => {
            const supplier = suppliers.find(s => s.id === guideSupplierId);
            const days = (() => { try { return JSON.parse(supplier?.order_days || '[]'); } catch { return []; } })();
            if (days.length === 0) return null;
            const dayStr = days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(' & ');
            return <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-200 mb-3 text-[12px] text-blue-800"><span className="text-[14px] mt-0.5">&#128197;</span><span>Order days: <strong>{dayStr}</strong></span></div>;
          })()}

          <SearchInput value={guideSearch} onChange={setGuideSearch} placeholder="Search products..." />

          <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
            {allCategories.map(cat => (
              <button key={cat} onClick={() => setGuideCategory(cat)} className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 ${guideCategory === cat ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{cat}</button>
            ))}
          </div>

          {filtered.length === 0 && <div className="text-center py-12"><div className="text-[15px] font-semibold text-[#1F2933] mb-1">No products found</div></div>}

          {categories.map(cat => (
            <div key={cat}>
              <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pt-3 pb-2 flex justify-between"><span>{cat}</span><span className="font-mono text-gray-300">{filtered.filter(i => (i.category_name || 'Other') === cat).length}</span></div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
                {filtered.filter(i => (i.category_name || 'Other') === cat).map(item => {
                  const qty = quantities[item.product_id] || 0;
                  return (
                    <div key={item.id} className={`flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0 ${qty > 0 ? 'bg-orange-50 -mx-3.5 px-3.5 rounded-lg mb-1' : ''}`}>
                      <div className="w-10 h-10 rounded-lg bg-[#F1F3F5] flex items-center justify-center text-[14px] flex-shrink-0">&#128230;</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{item.product_uom}</div>
                        <div className="text-[13px] font-semibold text-[#1F2933] truncate">{item.product_name}</div>
                        <div className="text-[12px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div>
                      </div>
                      {qty > 0 ? (
                        <div className="flex items-center flex-shrink-0">
                          <button onClick={() => updateCartQty(item, Math.max(0, qty - 1))} className="w-9 h-9 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[16px] text-gray-600 active:bg-gray-100">-</button>
                          <button onClick={() => openNumpad(item)} className="w-10 h-9 flex items-center justify-center text-[15px] font-bold font-mono text-[#1F2933]">{qty}</button>
                          <button onClick={() => updateCartQty(item, qty + 1)} className="w-9 h-9 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[16px] text-gray-600 active:bg-gray-100">+</button>
                        </div>
                      ) : (
                        <button onClick={() => updateCartQty(item, 1)} className="w-9 h-9 rounded-lg bg-orange-500 flex items-center justify-center text-white text-[18px] font-bold shadow-sm active:bg-orange-600 flex-shrink-0">+</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {cartItemCount > 0 && (
          <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
            <div className="flex justify-between items-center mb-2">
              <div>
                <div className="text-[18px] font-extrabold font-mono text-[#1F2933]">&euro;{cartAmount.toFixed(2)}</div>
                <div className="text-[11px] text-gray-500">{cartItemCount} items &bull; shared cart ({locName})</div>
              </div>
            </div>
            <button onClick={() => changeTab('cart')} className="w-full py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 active:scale-[0.975] transition-all">View cart &rarr;</button>
          </div>
        )}
      </>
    );
  };

  // ============== CART ==============
  const CartView = () => (
    <div className="px-4 py-3 pb-20">
      {carts.length === 0 ? (
        <div className="text-center py-16"><div className="text-4xl mb-3">&#128722;</div><div className="text-[15px] font-semibold text-[#1F2933] mb-1">Cart is empty</div><div className="text-[13px] text-gray-500">Go to a supplier and add products.</div></div>
      ) : (
        <>
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-2">
            <div className="flex items-center gap-3">
              <span className="text-[16px]">&#128197;</span>
              <div className="flex-1"><div className="text-[13px] font-semibold text-[#1F2933]">Delivery date</div></div>
              <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)} className="text-[13px] text-gray-600 border border-gray-200 rounded-lg px-2 py-1" />
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3.5 mb-3">
            <div className="text-[13px] font-semibold text-[#1F2933] mb-1">Order note</div>
            <textarea value={orderNote} onChange={e => setOrderNote(e.target.value)} placeholder="Add a note for this order..." rows={2} className="w-full text-[13px] text-gray-600 border border-gray-200 rounded-lg px-3 py-2 resize-none outline-none focus:border-orange-400" />
          </div>
          {carts.map(cart => (
            <div key={cart.id} className="mb-4">
              <div className="flex justify-between items-center py-2">
                <span className="text-[11px] font-bold tracking-wide uppercase text-gray-400">{cart.supplier_name}</span>
                <div className="flex gap-1.5">
                  <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-blue-100 text-blue-800">{cart.send_method === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>
                  {cart.approval_required === 1 && <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-100 text-amber-800">Approval required</span>}
                </div>
              </div>
              {cart.min_order_value > 0 && cart.total < cart.min_order_value && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 mb-2 text-[11px] text-amber-800">
                  <span>&#9888;&#65039;</span> Min. order: &euro;{cart.min_order_value.toFixed(2)}. You need &euro;{(cart.min_order_value - cart.total).toFixed(2)} more.
                </div>
              )}
              <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
                {cart.items.map((item: any) => (
                  <div key={item.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-semibold text-[#1F2933] truncate">{item.product_name}</div>
                      <div className="text-[12px] text-gray-500 font-mono">{item.quantity} {item.product_uom} &bull; &euro;{(item.quantity * item.price).toFixed(2)}</div>
                    </div>
                    <div className="text-[14px] font-bold font-mono text-[#1F2933]">&euro;{(item.quantity * item.price).toFixed(2)}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center mt-1 px-1">
                <div className="text-[13px] font-bold font-mono text-[#1F2933]">&euro;{cart.total.toFixed(2)}</div>
                <div className="text-[11px] text-gray-400">{cart.item_count} items</div>
              </div>
              <button onClick={() => sendOrder(cart)} disabled={sending} className="w-full mt-2 py-3 rounded-xl bg-orange-500 text-white text-[13px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 disabled:opacity-50 transition-all">
                {sending ? 'Sending...' : `Send to ${cart.supplier_name.split(' ')[0]} \u2192`}
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );

  // ============== ORDER SENT ==============
  const OrderSent = () => (
    <div className="px-4 py-3 flex flex-col items-center pt-16">
      <div className="w-16 h-16 rounded-[18px] bg-green-100 flex items-center justify-center mb-4"><svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg></div>
      <div className="text-[18px] font-bold text-[#1F2933] mb-2">Order sent!</div>
      <div className="text-[13px] text-gray-500 text-center max-w-[280px] leading-relaxed mb-6">Your order has been submitted.</div>
      <button onClick={() => changeTab('order')} className="w-full max-w-[300px] py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 mb-3">Place another order</button>
      <button onClick={() => changeTab('history')} className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold mb-3">View order history</button>
      <button onClick={goHome} className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold">Back to dashboard</button>
    </div>
  );

  // ============== HISTORY ==============
  const HistoryView = () => {
    const fm: Record<string, string[]> = { all: [], sent: ['sent'], delivered: ['received'], approval: ['pending_approval'], issues: ['partial'] };
    const filtered = historyFilter === 'all' ? orders : orders.filter(o => fm[historyFilter]?.includes(o.status));
    return (
      <div className="px-4 py-3">
        <div className="flex gap-1.5 overflow-x-auto pb-3">
          {['all', 'sent', 'delivered', 'approval', 'issues'].map(f => (
            <button key={f} onClick={() => setHistoryFilter(f)} className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap flex-shrink-0 capitalize ${historyFilter === f ? 'bg-orange-500 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{f}</button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="text-center py-16"><div className="text-[15px] font-semibold text-[#1F2933] mb-1">No orders yet</div></div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
            {filtered.map(order => (
              <button key={order.id} onClick={() => openOrderDetail(order)} className="w-full flex items-center gap-3 py-3 border-b border-gray-100 last:border-0 text-left active:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-[#1F2933]">{order.supplier_name}</div>
                  <div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`} &bull; {new Date(order.created_at).toLocaleDateString('de-DE')}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-[13px] font-bold font-mono text-[#1F2933]">&euro;{order.total_amount.toFixed(2)}</div>
                  <StatusBadge status={order.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ============== ORDER DETAIL ==============
  const OrderDetail = () => {
    if (!selectedOrder) return null;
    const canCancel = ['draft', 'pending_approval', 'approved'].includes(selectedOrder.status);
    return (
      <div className="px-4 py-3">
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-4 mb-3">
          <div className="flex justify-between items-start mb-3">
            <div><div className="text-[16px] font-bold text-[#1F2933]">{selectedOrder.supplier_name}</div><div className="text-[12px] text-gray-500 font-mono mt-1">{selectedOrder.odoo_po_name || `#${selectedOrder.id}`}</div></div>
            <StatusBadge status={selectedOrder.status} />
          </div>
          <div className="text-[12px] text-gray-500 mb-1">Ordered: {new Date(selectedOrder.created_at).toLocaleString('de-DE')}</div>
          {selectedOrder.delivery_date && <div className="text-[12px] text-gray-500">Delivery: {selectedOrder.delivery_date}</div>}
          {selectedOrder.order_note && <div className="text-[12px] text-gray-500 mt-1">Note: {selectedOrder.order_note}</div>}
        </div>
        {selectedOrder.lines && selectedOrder.lines.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5 mb-3">
            {selectedOrder.lines.map((line: any) => (
              <div key={line.id} className="flex justify-between py-2.5 border-b border-gray-100 last:border-0 text-[13px]">
                <div className="text-[#1F2933]">{line.product_name}</div>
                <div className="font-mono text-gray-500">{line.quantity} {line.product_uom} &bull; &euro;{line.subtotal.toFixed(2)}</div>
              </div>
            ))}
          </div>
        )}
        <div className="text-right text-[16px] font-bold font-mono text-[#1F2933] mb-4">&euro;{selectedOrder.total_amount.toFixed(2)}</div>
        {canCancel && <button onClick={cancelSelectedOrder} className="w-full py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold active:bg-red-100">Cancel order</button>}
      </div>
    );
  };

  // ============== RECEIVE LIST ==============
  const ReceiveList = () => (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Pending deliveries</div>
      {pendingDeliveries.length === 0 ? (
        <div className="text-center py-16"><div className="text-[15px] font-semibold text-[#1F2933] mb-1">No pending deliveries</div><div className="text-[13px] text-gray-500">Sent orders will appear here.</div></div>
      ) : (
        pendingDeliveries.map(order => (
          <button key={order.id} onClick={() => openReceiveCheck(order)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5 active:scale-[0.98] transition-transform text-left">
            <div className="w-10 h-10 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">{(order.supplier_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-[#1F2933]">{order.supplier_name}</div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`}</div>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-100 text-amber-800">{order.status === 'partial' ? 'Partial' : 'Pending'}</span>
          </button>
        ))
      )}
    </div>
  );

  // ============== RECEIVE CHECK ==============
  const ReceiveCheck = () => (
    <div className="px-4 py-3 pb-40">
      <p className="text-[12px] text-gray-500 mb-3">Enter the quantity you actually received. Leave blank if not delivered yet.</p>
      <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
        {receiptLines.map(line => (
          <div key={line.id} className="flex items-center gap-2.5 py-3 border-b border-gray-100 last:border-0">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-[#1F2933]">{line.product_name}</div>
              <div className="text-[11px] text-gray-500 font-mono">Ordered: {line.ordered_qty} {line.product_uom}</div>
              {line.has_issue === 1 && <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-red-100 text-red-800 mt-1 inline-block">{line.issue_type || 'Issue'}</span>}
            </div>
            <input type="number" placeholder="-" value={line.received_qty ?? ''} onChange={e => updateRecvQty(line.id, parseFloat(e.target.value) || 0)}
              className="w-16 h-9 rounded-lg border border-gray-200 text-center text-[14px] font-bold font-mono text-[#1F2933] outline-none focus:border-orange-400" />
            {line.received_qty !== null && line.received_qty === line.ordered_qty && <span className="text-green-500 text-[16px]">&#10003;</span>}
            {line.received_qty !== null && line.received_qty < line.ordered_qty && <span className="text-red-600 text-[12px] font-bold font-mono">{line.difference}</span>}
            <button onClick={() => openIssueReport(line)} className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center text-[14px] flex-shrink-0 active:bg-red-100">&#128247;</button>
          </div>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        {isManager ? (
          <>
            <div className="flex gap-2 mb-2">
              <button onClick={() => confirmReceiptAction(true)} className="flex-1 py-3 rounded-xl bg-green-600 text-white text-[13px] font-bold active:bg-green-700">Confirm &amp; close</button>
              <button onClick={() => confirmReceiptAction(false)} className="flex-1 py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold active:bg-gray-50">Keep as backorder</button>
            </div>
            <p className="text-[11px] text-gray-400 text-center">Confirming will update stock in Odoo.</p>
          </>
        ) : (
          <p className="text-[12px] text-gray-500 text-center py-2">A manager must confirm receipt to update stock.</p>
        )}
      </div>
    </div>
  );

  // ============== RECEIVE ISSUE ==============
  const ReceiveIssue = () => {
    const [issueType, setIssueType] = useState(issueLine?.issue_type || 'Damaged');
    const [notes, setNotes] = useState(issueLine?.issue_notes || '');
    const types = ['Damaged', 'Wrong item', 'Short delivery', 'Expired', 'Quality'];
    return (
      <div className="px-4 py-3">
        <div className="text-[15px] font-bold text-[#1F2933] mb-1">{issueLine?.product_name}</div>
        <div className="text-[12px] text-gray-500 mb-4">Ordered: {issueLine?.ordered_qty} {issueLine?.product_uom}</div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Issue type</label>
        <div className="flex gap-1.5 flex-wrap mb-4">
          {types.map(t => (
            <button key={t} onClick={() => setIssueType(t)} className={`px-3 py-1.5 rounded-full text-[11px] font-semibold ${issueType === t ? 'bg-red-500 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{t}</button>
          ))}
        </div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-gray-400 block mb-2">Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Describe the issue..." rows={3} className="w-full text-[13px] border border-gray-200 rounded-xl px-3 py-2 resize-none outline-none focus:border-orange-400 mb-4" />
        <button onClick={() => submitIssue(issueType, notes)} className="w-full py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30">Submit report</button>
      </div>
    );
  };

  // ============== MANAGE ==============
  const ManageScreen = () => (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Edit order guides</div>
      {suppliers.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-[13px] text-gray-500 mb-4">No suppliers yet. Seed from Odoo first.</div>
          {isAdmin && <button onClick={runSeed} className="py-3 px-6 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30">Seed suppliers from Odoo</button>}
          {seedMsg && <p className="text-[12px] text-gray-500 mt-3">{seedMsg}</p>}
        </div>
      ) : (
        suppliers.map(s => (
          <button key={s.id} onClick={() => openManageGuide(s)} className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5 active:scale-[0.98] transition-transform text-left">
            <div className="w-10 h-10 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">{s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
            <div className="flex-1 min-w-0"><div className="text-[13px] font-bold text-[#1F2933] truncate">{s.name}</div><div className="text-[11px] text-gray-500">{s.product_count} products &bull; Tap to edit</div></div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
          </button>
        ))
      )}
    </div>
  );

  const ManageGuideScreen = () => (
    <div className="px-4 py-3">
      {guideItems.length === 0 ? (
        <div className="text-center py-12"><div className="text-[15px] font-semibold text-[#1F2933] mb-1">No products in guide</div><div className="text-[13px] text-gray-500">Run seed to populate from Odoo, or add via API.</div></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
          {guideItems.map(item => (
            <div key={item.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[#1F2933] truncate">{item.product_name}</div>
                <div className="text-[11px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom} &bull; {item.price_source}</div>
              </div>
              <button onClick={() => removeGuideItemAction(item.id)} className="text-[11px] font-semibold text-red-600 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100 active:bg-red-100 flex-shrink-0">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ============== NUMPAD ==============
  const Numpad = () => numpadOpen ? (
    <div className="fixed inset-0 bg-black/40 z-[100] flex items-end justify-center" onClick={() => setNumpadOpen(false)}>
      <div className="bg-white rounded-t-[20px] w-full max-w-lg p-5 pb-7" onClick={e => e.stopPropagation()}>
        <div className="text-center pb-4"><div className="text-[12px] text-gray-400">{numpadProduct?.product_uom}</div><div className="text-[15px] font-bold text-[#1F2933]">{numpadProduct?.product_name}</div></div>
        <div className="text-center text-[36px] font-extrabold font-mono text-[#1F2933] pb-4">{numpadValue || '0'}</div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {['1','2','3','4','5','6','7','8','9','.','0','del'].map(k => (
            <button key={k} onClick={() => numpadKey(k)} className="h-14 rounded-xl border border-gray-200 bg-white text-[20px] font-semibold text-[#1F2933] flex items-center justify-center active:bg-gray-100 font-mono">{k === 'del' ? '\u232B' : k}</button>
          ))}
        </div>
        <button onClick={confirmNumpad} className="w-full py-4 rounded-2xl bg-orange-500 text-white text-[15px] font-bold shadow-lg shadow-orange-500/30">Confirm</button>
      </div>
    </div>
  ) : null;

  // ============== RENDER ==============
  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      {screen === 'guide' ? (
        <><Header title={guideSupplierName} subtitle={`${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => { setScreen('suppliers'); setTab('order'); }} /><OrderGuide /></>
      ) : screen === 'manage' ? (
        <><Header title="Manage Purchases" subtitle="Guides, suppliers, settings" showBack onBack={() => { setScreen('suppliers'); setTab('order'); }} /><LocationPicker /><ManageScreen /></>
      ) : screen === 'manage-guide' ? (
        <><Header title={guideSupplierName} subtitle={`Edit guide \u2022 ${locName}`} showBack onBack={() => setScreen('manage')} /><ManageGuideScreen /></>
      ) : screen === 'sent' ? (
        <><Header title="Purchase" /><OrderSent /></>
      ) : screen === 'order-detail' ? (
        <><Header title="Order details" showBack onBack={() => { setScreen('history'); setTab('history'); }} /><OrderDetail /></>
      ) : screen === 'receive-check' ? (
        <><Header title={selectedOrder?.supplier_name || 'Receive'} subtitle={selectedOrder?.odoo_po_name || ''} showBack onBack={() => { setScreen('receive-list'); setTab('receive'); }} /><ReceiveCheck /></>
      ) : screen === 'receive-issue' ? (
        <><Header title="Report issue" showBack onBack={() => setScreen('receive-check')} /><ReceiveIssue /></>
      ) : (
        <><Header title="Purchase" subtitle="Order from your suppliers" /><LocationPicker /><Tabs />
          {tab === 'order' && <SupplierList />}
          {tab === 'cart' && <CartView />}
          {tab === 'receive' && <ReceiveList />}
          {tab === 'history' && <HistoryView />}
        </>
      )}
      <Numpad />
    </div>
  );
}
