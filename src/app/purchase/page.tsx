'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Supplier { id: number; name: string; email: string; product_count: number; order_days: string; min_order_value: number; approval_required: number; send_method: string; }
interface GuideItem { id: number; product_id: number; product_name: string; product_uom: string; price: number; price_source: string; category_name: string; }
interface CartSummary { id: number; supplier_id: number; supplier_name: string; item_count: number; total: number; items: any[]; }
interface Order { id: number; supplier_name: string; odoo_po_name: string | null; status: string; total_amount: number; created_at: string; lines?: any[]; delivery_date: string | null; }

type Tab = 'order' | 'catalog' | 'cart' | 'receive' | 'history';
type Screen = 'suppliers' | 'guide' | 'catalog' | 'cart' | 'sent' | 'receive-list' | 'receive-check' | 'history' | 'manage' | 'manage-guide';

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

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [guideItems, setGuideItems] = useState<GuideItem[]>([]);
  const [guideSupplierId, setGuideSupplierId] = useState(0);
  const [guideSupplierName, setGuideSupplierName] = useState('');
  const [carts, setCarts] = useState<CartSummary[]>([]);
  const [cartTotal, setCartTotal] = useState({ items: 0, amount: 0 });
  const [orders, setOrders] = useState<Order[]>([]);
  const [pendingDeliveries, setPendingDeliveries] = useState<Order[]>([]);
  const [numpadOpen, setNumpadOpen] = useState(false);
  const [numpadProduct, setNumpadProduct] = useState<GuideItem | null>(null);
  const [numpadValue, setNumpadValue] = useState('');
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [seedMsg, setSeedMsg] = useState('');

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user) setUser(d.user); });
  }, []);

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchase/suppliers?location_id=${locationId}`);
      const data = await res.json();
      setSuppliers(data.suppliers || []);
    } catch (_e) { /* ignore */ }
    finally { setLoading(false); }
  }, [locationId]);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);

  const fetchCart = useCallback(async () => {
    try {
      const res = await fetch(`/api/purchase/cart?location_id=${locationId}`);
      const data = await res.json();
      setCarts(data.carts || []);
      setCartTotal({ items: data.total_items || 0, amount: data.total_amount || 0 });
    } catch (_e) { /* ignore */ }
  }, [locationId]);

  useEffect(() => { fetchCart(); }, [fetchCart]);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch(`/api/purchase/orders?location_id=${locationId}&limit=20`);
      const data = await res.json();
      setOrders(data.orders || []);
    } catch (_e) { /* ignore */ }
  }, [locationId]);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch(`/api/purchase/receive?location_id=${locationId}`);
      const data = await res.json();
      setPendingDeliveries(data.pending || []);
    } catch (_e) { /* ignore */ }
  }, [locationId]);

  async function openGuide(supplier: Supplier) {
    setGuideSupplierId(supplier.id);
    setGuideSupplierName(supplier.name);
    setScreen('guide');
    try {
      const res = await fetch(`/api/purchase/guides?supplier_id=${supplier.id}&location_id=${locationId}`);
      const data = await res.json();
      setGuideItems(data.guide?.items || []);
      const cartRes = await fetch(`/api/purchase/cart?location_id=${locationId}`);
      const cartData = await cartRes.json();
      const supplierCart = (cartData.carts || []).find((c: any) => c.supplier_id === supplier.id);
      const qtys: Record<number, number> = {};
      if (supplierCart) {
        for (const item of supplierCart.items) { qtys[item.product_id] = item.quantity; }
      }
      setQuantities(qtys);
    } catch (_e) { setGuideItems([]); }
  }

  async function openManageGuide(supplier: Supplier) {
    setGuideSupplierId(supplier.id);
    setGuideSupplierName(supplier.name);
    setScreen('manage-guide');
    try {
      const res = await fetch(`/api/purchase/guides?supplier_id=${supplier.id}&location_id=${locationId}`);
      const data = await res.json();
      setGuideItems(data.guide?.items || []);
    } catch (_e) { setGuideItems([]); }
  }

  async function removeGuideItem(itemId: number) {
    await fetch(`/api/purchase/guides?item_id=${itemId}`, { method: 'DELETE' });
    const res = await fetch(`/api/purchase/guides?supplier_id=${guideSupplierId}&location_id=${locationId}`);
    const data = await res.json();
    setGuideItems(data.guide?.items || []);
    fetchSuppliers();
  }

  async function runSeed() {
    setSeedMsg('Seeding...');
    try {
      const res = await fetch('/api/purchase/seed', { method: 'POST' });
      const data = await res.json();
      setSeedMsg(data.message || 'Done');
      fetchSuppliers();
    } catch (e: any) {
      setSeedMsg(`Error: ${e.message}`);
    }
  }

  async function updateCartQty(product: GuideItem, qty: number) {
    setQuantities(prev => ({ ...prev, [product.product_id]: qty }));
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
  }

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
    if (numpadProduct) {
      const val = parseFloat(numpadValue) || 0;
      updateCartQty(numpadProduct, val);
    }
    setNumpadOpen(false);
  }

  function changeTab(t: Tab) {
    setTab(t);
    if (t === 'order') setScreen('suppliers');
    else if (t === 'catalog') setScreen('catalog');
    else if (t === 'cart') { setScreen('cart'); fetchCart(); }
    else if (t === 'receive') { setScreen('receive-list'); fetchPending(); }
    else if (t === 'history') { setScreen('history'); fetchOrders(); }
  }

  function goHome() { router.push('/'); }

  const isManager = user?.role === 'manager' || user?.role === 'admin';
  const isAdmin = user?.role === 'admin';
  const locName = LOCATIONS.find(l => l.id === locationId)?.name || 'SSAM';

  // ========== HOME ICON SVG ==========
  const HomeIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  );
  const BackIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M15 19l-7-7 7-7"/></svg>
  );

  // ========== HEADER ==========
  const Header = ({ title, subtitle, showBack, onBack }: { title: string; subtitle?: string; showBack?: boolean; onBack?: () => void }) => (
    <div className="bg-[#1A1F2E] px-5 pt-12 pb-0 relative overflow-hidden">
      <div className="absolute -top-10 -right-5 w-40 h-40 rounded-full bg-[radial-gradient(circle,rgba(245,128,10,0.08)_0%,transparent_70%)]" />
      <div className="flex items-center gap-3 relative pb-3">
        <button onClick={showBack ? onBack : goHome}
          className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors">
          {showBack ? <BackIcon /> : <HomeIcon />}
        </button>
        <div className="flex-1">
          <h1 className="text-[20px] font-bold text-white">{title}</h1>
          {subtitle && <p className="text-[12px] text-white/45 mt-0.5">{subtitle}</p>}
        </div>
        {showBack && (
          <button onClick={goHome}
            className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20 transition-colors" title="Dashboard">
            <HomeIcon />
          </button>
        )}
      </div>
    </div>
  );

  const LocationPicker = () => (
    <div className="bg-[#1A1F2E] px-5 pb-3 flex gap-2 relative">
      {LOCATIONS.map(loc => (
        <button key={loc.id} onClick={() => setLocationId(loc.id)}
          className={`px-4 py-1.5 rounded-full text-[11px] font-bold transition-all ${
            locationId === loc.id ? 'bg-orange-500 text-white' : 'bg-white/10 text-white/45'
          }`}>{loc.name}</button>
      ))}
    </div>
  );

  const Tabs = () => (
    <div className="flex gap-1 px-4 py-2.5 bg-white border-b border-gray-200 overflow-x-auto">
      {(['order', 'catalog', 'cart', 'receive', 'history'] as Tab[]).map(t => (
        <button key={t} onClick={() => changeTab(t)}
          className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap flex-shrink-0 transition-all ${
            tab === t ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'
          }`}>
          {t === 'order' ? 'Order' : t === 'catalog' ? 'Catalog' :
           t === 'cart' ? `Cart${cartTotal.items > 0 ? ` (${cartTotal.items})` : ''}` :
           t === 'receive' ? 'Receive' : 'History'}
        </button>
      ))}
    </div>
  );

  // ========== SUPPLIER LIST ==========
  const SupplierList = () => (
    <div className="px-4 py-3">
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-7 h-7 border-2 border-gray-300 border-t-orange-500 rounded-full animate-spin" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#128722;</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No suppliers yet</div>
          <div className="text-[13px] text-gray-500 mb-6">Set up suppliers and order guides first.</div>
          {isAdmin && (
            <>
              <button onClick={runSeed}
                className="w-full max-w-[300px] py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 mb-3">
                Seed suppliers from Odoo
              </button>
              {seedMsg && <p className="text-[12px] text-gray-500 mt-2">{seedMsg}</p>}
              <button onClick={() => setScreen('manage')}
                className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold mt-2">
                Manage manually
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {suppliers.map(s => {
            const days = (() => { try { return JSON.parse(s.order_days); } catch { return []; } })();
            const dayStr = days.length > 0 ? days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(' & ') : '';
            return (
              <button key={s.id} onClick={() => openGuide(s)}
                className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] mb-2.5 active:scale-[0.98] transition-transform text-left">
                <div className="w-12 h-12 rounded-[14px] bg-[#F1F3F5] flex items-center justify-center text-[16px] font-bold text-blue-600 flex-shrink-0">
                  {s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-bold text-[#1F2933] truncate">{s.name}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{s.product_count} products in guide</div>
                  {dayStr && <div className="text-[10px] font-semibold text-blue-600 mt-1">Orders: {dayStr}</div>}
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
              </button>
            );
          })}
          {isManager && (
            <div className="text-center mt-4">
              <button onClick={() => setScreen('manage')}
                className="text-[12px] font-semibold text-orange-600 px-4 py-2 rounded-lg bg-orange-50 active:bg-orange-100">
                Manage guides &amp; settings
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );

  // ========== MANAGE SCREEN (manager/admin) ==========
  const ManageScreen = () => (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Edit order guides</div>
      {suppliers.map(s => (
        <button key={s.id} onClick={() => openManageGuide(s)}
          className="w-full flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_4px_8px_rgba(0,0,0,0.06)] mb-2.5 active:scale-[0.98] transition-transform text-left">
          <div className="w-10 h-10 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">
            {s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-[#1F2933] truncate">{s.name}</div>
            <div className="text-[11px] text-gray-500">{s.product_count} products &bull; Tap to edit</div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2"><path d="M9 5l7 7-7 7"/></svg>
        </button>
      ))}
      {suppliers.length === 0 && (
        <div className="text-center py-12">
          <div className="text-[13px] text-gray-500 mb-4">No suppliers yet. Seed from Odoo first.</div>
          {isAdmin && (
            <button onClick={runSeed}
              className="py-3 px-6 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30">
              Seed suppliers from Odoo
            </button>
          )}
          {seedMsg && <p className="text-[12px] text-gray-500 mt-3">{seedMsg}</p>}
        </div>
      )}
    </div>
  );

  // ========== MANAGE GUIDE (edit items for one supplier) ==========
  const ManageGuideScreen = () => (
    <div className="px-4 py-3">
      {guideItems.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No products in guide</div>
          <div className="text-[13px] text-gray-500">Run seed to populate from Odoo, or add manually via API.</div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
          {guideItems.map(item => (
            <div key={item.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0">
              <div className="w-9 h-9 rounded-lg bg-[#F1F3F5] flex items-center justify-center text-[13px] flex-shrink-0">&#128230;</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[#1F2933] truncate">{item.product_name}</div>
                <div className="text-[11px] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom} &bull; {item.price_source}</div>
              </div>
              <button onClick={() => removeGuideItem(item.id)}
                className="text-[11px] font-semibold text-red-600 px-3 py-1.5 rounded-lg bg-red-50 border border-red-100 active:bg-red-100 flex-shrink-0">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ========== ORDER GUIDE ==========
  const OrderGuide = () => {
    const categories = Array.from(new Set(guideItems.map(i => i.category_name || 'Other')));
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
            return (
              <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-200 mb-3 text-[12px] text-blue-800">
                <span className="text-[14px] mt-0.5">&#128197;</span>
                <span>Order days: <strong>{dayStr}</strong></span>
              </div>
            );
          })()}
          {guideItems.length === 0 && (
            <div className="text-center py-12">
              <div className="text-[15px] font-semibold text-[#1F2933] mb-1">No products in guide</div>
              <div className="text-[13px] text-gray-500">Ask a manager to set up the order guide.</div>
            </div>
          )}
          {categories.map(cat => (
            <div key={cat}>
              <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pt-4 pb-2 flex justify-between">
                <span>{cat}</span>
                <span className="font-mono text-gray-300">{guideItems.filter(i => (i.category_name || 'Other') === cat).length}</span>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
                {guideItems.filter(i => (i.category_name || 'Other') === cat).map(item => {
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

  const CartView = () => (
    <div className="px-4 py-3 pb-40">
      {carts.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">&#128722;</div>
          <div className="text-[15px] font-semibold text-[#1F2933] mb-1">Cart is empty</div>
          <div className="text-[13px] text-gray-500">Go to a supplier and add products.</div>
        </div>
      ) : (
        carts.map(cart => (
          <div key={cart.id} className="mb-4">
            <div className="flex justify-between items-center py-2">
              <span className="text-[11px] font-bold tracking-wide uppercase text-gray-400">{cart.supplier_name}</span>
              <span className="text-[12px] font-semibold text-orange-600">{cart.item_count} items</span>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
              {cart.items.map((item: any) => (
                <div key={item.id} className="flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0 bg-orange-50 -mx-3.5 px-3.5 rounded-lg mb-1">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-[#1F2933] truncate">{item.product_name}</div>
                    <div className="text-[12px] text-gray-500 font-mono">{item.quantity} {item.product_uom} &bull; &euro;{(item.quantity * item.price).toFixed(2)}</div>
                  </div>
                  <div className="text-[14px] font-bold font-mono text-[#1F2933]">&euro;{(item.quantity * item.price).toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
      {carts.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
          <div className="flex justify-between items-center mb-1">
            <div className="text-[18px] font-extrabold font-mono text-[#1F2933]">&euro;{cartTotal.amount.toFixed(2)}</div>
            <div className="text-[11px] text-gray-500">{cartTotal.items} items &bull; {carts.length} supplier{carts.length > 1 ? 's' : ''}</div>
          </div>
          <div className="bg-gray-50 rounded-lg px-3 py-2 mb-2">
            {carts.map(c => (
              <div key={c.id} className="flex justify-between text-[11px] text-gray-600 py-0.5">
                <span>{c.supplier_name} ({c.item_count})</span>
                <span className="font-mono font-semibold text-[#1F2933]">&euro;{c.total.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <button onClick={async () => {
              for (const cart of carts) {
                await fetch('/api/purchase/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart_id: cart.id, delivery_date: null, order_note: '' }) });
              }
              fetchCart(); setScreen('sent');
            }} className="w-full py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 active:bg-orange-600 transition-all">Send order &rarr;</button>
        </div>
      )}
    </div>
  );

  const OrderSent = () => (
    <div className="px-4 py-3 flex flex-col items-center pt-16">
      <div className="w-16 h-16 rounded-[18px] bg-green-100 flex items-center justify-center mb-4">
        <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="#16A34A" strokeWidth="2" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
      </div>
      <div className="text-[18px] font-bold text-[#1F2933] mb-2">Order sent!</div>
      <div className="text-[13px] text-gray-500 text-center max-w-[280px] leading-relaxed mb-6">Your order has been submitted.</div>
      <button onClick={() => changeTab('order')} className="w-full max-w-[300px] py-3.5 rounded-xl bg-orange-500 text-white text-[14px] font-bold shadow-lg shadow-orange-500/30 mb-3">Place another order</button>
      <button onClick={() => changeTab('history')} className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold mb-3">View order history</button>
      <button onClick={goHome} className="w-full max-w-[300px] py-3 rounded-xl bg-white border border-gray-200 text-gray-700 text-[13px] font-semibold">Back to dashboard</button>
    </div>
  );

  const HistoryView = () => (
    <div className="px-4 py-3">
      {orders.length === 0 ? (
        <div className="text-center py-16"><div className="text-[15px] font-semibold text-[#1F2933] mb-1">No orders yet</div><div className="text-[13px] text-gray-500">Orders from {locName} will appear here.</div></div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
          {orders.map(order => {
            const ss: Record<string, string> = { pending_approval: 'bg-amber-100 text-amber-800', approved: 'bg-blue-100 text-blue-800', sent: 'bg-blue-100 text-blue-800', received: 'bg-green-100 text-green-800', partial: 'bg-amber-100 text-amber-800', cancelled: 'bg-red-100 text-red-800', draft: 'bg-gray-100 text-gray-700' };
            const sl: Record<string, string> = { pending_approval: 'Awaiting approval', approved: 'Approved', sent: 'Sent', received: 'Delivered', partial: 'Partial', cancelled: 'Cancelled', draft: 'Draft' };
            return (
              <div key={order.id} className="flex items-center gap-3 py-3 border-b border-gray-100 last:border-0">
                <div className="flex-1 min-w-0"><div className="text-[13px] font-bold text-[#1F2933]">{order.supplier_name}</div><div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`} &bull; {new Date(order.created_at).toLocaleDateString('de-DE')}</div></div>
                <div className="text-right flex-shrink-0"><div className="text-[13px] font-bold font-mono text-[#1F2933]">&euro;{order.total_amount.toFixed(2)}</div><span className={`text-[10px] px-2 py-0.5 rounded-md font-bold ${ss[order.status] || 'bg-gray-100 text-gray-700'}`}>{sl[order.status] || order.status}</span></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const ReceiveList = () => (
    <div className="px-4 py-3">
      <div className="text-[11px] font-bold tracking-wide uppercase text-gray-400 pb-2">Pending deliveries</div>
      {pendingDeliveries.length === 0 ? (
        <div className="text-center py-16"><div className="text-[15px] font-semibold text-[#1F2933] mb-1">No pending deliveries</div><div className="text-[13px] text-gray-500">Sent orders will appear here.</div></div>
      ) : (
        pendingDeliveries.map(order => (
          <div key={order.id} className="flex items-center gap-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] mb-2.5">
            <div className="w-10 h-10 rounded-xl bg-[#F1F3F5] flex items-center justify-center text-[14px] font-bold text-blue-600 flex-shrink-0">{(order.supplier_name || '??').split(' ').map(w => w[0]).join('').slice(0, 2)}</div>
            <div className="flex-1 min-w-0"><div className="text-[14px] font-bold text-[#1F2933]">{order.supplier_name}</div><div className="text-[11px] text-gray-500 font-mono mt-0.5">{order.odoo_po_name || `#${order.id}`}</div></div>
            <span className="text-[10px] px-2 py-0.5 rounded-md font-bold bg-amber-100 text-amber-800">{order.status === 'partial' ? 'Partial' : 'Pending'}</span>
          </div>
        ))
      )}
    </div>
  );

  const Numpad = () => (
    numpadOpen ? (
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
    ) : null
  );

  // ========== RENDER ==========
  return (
    <div className="min-h-screen bg-[#F6F7F9]">
      {screen === 'guide' ? (
        <>
          <Header title={guideSupplierName} subtitle={`${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => { setScreen('suppliers'); setTab('order'); }} />
          <OrderGuide />
        </>
      ) : screen === 'manage' ? (
        <>
          <Header title="Manage Purchases" subtitle="Guides, suppliers, settings" showBack onBack={() => { setScreen('suppliers'); setTab('order'); }} />
          <LocationPicker />
          <ManageScreen />
        </>
      ) : screen === 'manage-guide' ? (
        <>
          <Header title={guideSupplierName} subtitle={`Edit guide \u2022 ${locName}`} showBack onBack={() => { setScreen('manage'); }} />
          <ManageGuideScreen />
        </>
      ) : screen === 'sent' ? (
        <>
          <Header title="Purchase" />
          <OrderSent />
        </>
      ) : (
        <>
          <Header title="Purchase" subtitle="Order from your suppliers" />
          <LocationPicker />
          <Tabs />
          {tab === 'order' && <SupplierList />}
          {tab === 'catalog' && (
            <div className="px-4 py-3 text-center"><div className="text-[15px] font-semibold text-[#1F2933] mt-16 mb-1">Catalog</div><div className="text-[13px] text-gray-500">Browse all products &mdash; coming next.</div></div>
          )}
          {tab === 'cart' && <CartView />}
          {tab === 'receive' && <ReceiveList />}
          {tab === 'history' && <HistoryView />}
        </>
      )}
      <Numpad />
    </div>
  );
}
