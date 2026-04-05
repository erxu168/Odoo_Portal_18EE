'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Numpad from '@/components/ui/Numpad';
import LocationDropdown from '@/components/ui/LocationDropdown';
import OrdersDashboard from '@/components/purchase/OrdersDashboard';
import PurchaseAlerts from '@/components/purchase/PurchaseAlerts';
import PurchaseHeader from '@/components/purchase/PurchaseHeader';
import SupplierList from '@/components/purchase/SupplierList';
import OrderGuide from '@/components/purchase/OrderGuide';
import CartView from '@/components/purchase/CartView';
import ReviewOrder from '@/components/purchase/ReviewOrder';
import OrderSent from '@/components/purchase/OrderSent';
import HistoryView from '@/components/purchase/HistoryView';
import OrderDetail from '@/components/purchase/OrderDetail';
import ReceiveList from '@/components/purchase/ReceiveList';
import ReceiveCheck from '@/components/purchase/ReceiveCheck';
import ReceiveIssue from '@/components/purchase/ReceiveIssue';
import ManageScreen from '@/components/purchase/ManageScreen';
import ManageGuideScreen from '@/components/purchase/ManageGuideScreen';
import {
  Supplier, GuideItem, CartSummary, Order, ReceiptLine, OdooProduct,
  Tab, Screen, LOCATIONS,
} from '@/components/purchase/types';

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

  const [mgOrderDays, setMgOrderDays] = useState<string[]>([]);
  const [mgDeliveryDays, setMgDeliveryDays] = useState<string[]>([]);
  const [mgLeadTime, setMgLeadTime] = useState(1);
  const [mgConfigSaving, setMgConfigSaving] = useState(false);
  const [mgConfigOpen, setMgConfigOpen] = useState(false);

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
    setGuideSupplierId(supplier.id); setGuideSupplierName(supplier.name); setMgSearch(''); setMgCategory('All'); setMgResults([]); setScreen('manage-guide'); setMgConfigOpen(false);
    try { setMgOrderDays(JSON.parse(supplier.order_days || '[]')); } catch { setMgOrderDays([]); }
    try { setMgDeliveryDays(JSON.parse(supplier.delivery_days || '[]')); } catch { setMgDeliveryDays([]); }
    setMgLeadTime(supplier.lead_time_days || 1);
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

  async function saveSupplierConfig() {
    setMgConfigSaving(true);
    try {
      await fetch('/api/purchase/suppliers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: guideSupplierId,
          order_days: JSON.stringify(mgOrderDays),
          delivery_days: JSON.stringify(mgDeliveryDays),
          lead_time_days: mgLeadTime,
        }),
      });
      fetchSuppliers();
    } catch (e) { void e; }
    finally { setMgConfigSaving(false); }
  }

  async function runSeed() { setSeedMsg('Seeding...'); try { const r = await fetch('/api/purchase/seed', { method: 'POST' }); const d = await r.json(); setSeedMsg(d.message || 'Done'); fetchSuppliers(); } catch (e: any) { setSeedMsg(`Error: ${e.message}`); } }

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
  const locDropdown = <LocationDropdown locations={LOCATIONS} selectedId={locationId} onChange={setLocationId} variant="dark" />;

  // ============== RENDER ==============
  return (
    <div className="min-h-screen bg-gray-50">
      {screen === 'guide' ? (<><PurchaseHeader title={guideSupplierName} subtitle={`${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => setScreen('dashboard')} goHome={goHome} /><OrderGuide guideItems={guideItems} guideSearch={guideSearch} setGuideSearch={setGuideSearch} guideCategory={guideCategory} setGuideCategory={setGuideCategory} quantities={quantities} updateCartQty={updateCartQty} openNumpad={openNumpad} suppliers={suppliers} guideSupplierId={guideSupplierId} locName={locName} changeTab={changeTab} /></>
      ) : screen === 'manage' ? (<><PurchaseHeader title="Manage Purchases" subtitle="Guides, suppliers, settings" showBack onBack={() => setScreen('dashboard')} rightElement={locDropdown} goHome={goHome} /><ManageScreen suppliers={suppliers} isAdmin={isAdmin} runSeed={runSeed} seedMsg={seedMsg} openManageGuide={openManageGuide} /></>
      ) : screen === 'manage-guide' ? (<><PurchaseHeader title={guideSupplierName} subtitle={`Edit guide \u2022 ${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => setScreen('manage')} goHome={goHome} /><ManageGuideScreen guideItems={guideItems} mgSearch={mgSearch} mgCategory={mgCategory} mgResults={mgResults} mgCategories={mgCategories} mgSearching={mgSearching} mgAdding={mgAdding} mgConfigOpen={mgConfigOpen} setMgConfigOpen={setMgConfigOpen} mgOrderDays={mgOrderDays} setMgOrderDays={setMgOrderDays} mgDeliveryDays={mgDeliveryDays} setMgDeliveryDays={setMgDeliveryDays} mgLeadTime={mgLeadTime} setMgLeadTime={setMgLeadTime} mgConfigSaving={mgConfigSaving} saveSupplierConfig={saveSupplierConfig} searchProducts={searchProducts} handleMgCategoryChange={handleMgCategoryChange} addProductToGuide={addProductToGuide} removeGuideItemAction={removeGuideItemAction} setMgSearch={setMgSearch} setMgResults={setMgResults} /></>
      ) : screen === 'review' ? (<><PurchaseHeader title="Review order" subtitle={reviewCart?.supplier_name} showBack onBack={() => { setScreen('cart'); }} goHome={goHome} /><ReviewOrder reviewCart={reviewCart} deliveryDate={deliveryDate} orderNote={orderNote} locName={locName} sending={sending} calcCartTax={calcCartTax} setConfirmDialog={setConfirmDialog} sendOrder={sendOrder} /></>
      ) : screen === 'sent' ? (<><PurchaseHeader title="Purchase" goHome={goHome} /><OrderSent changeTab={changeTab} goHome={goHome} /></>
      ) : screen === 'order-detail' ? (<><PurchaseHeader title="Order details" showBack onBack={() => { setScreen('history'); }} goHome={goHome} /><OrderDetail selectedOrder={selectedOrder} setConfirmDialog={setConfirmDialog} cancelSelectedOrder={cancelSelectedOrder} /></>
      ) : screen === 'receive-check' ? (<><PurchaseHeader title={selectedOrder?.supplier_name || 'Receive'} subtitle={selectedOrder?.odoo_po_name || ''} showBack onBack={() => { setScreen('receive-list'); }} goHome={goHome} /><ReceiveCheck recvOrder={recvOrder} receiptLines={receiptLines} receipt={receipt} isManager={isManager} updateRecvQty={updateRecvQty} openIssueReport={openIssueReport} setConfirmDialog={setConfirmDialog} confirmReceiptAction={confirmReceiptAction} setRecvNumpadLineId={setRecvNumpadLineId} setCartNumpadItem={setCartNumpadItem} setNumpadProduct={setNumpadProduct} setNumpadValue={setNumpadValue} setNumpadOpen={setNumpadOpen} /></>
      ) : screen === 'receive-issue' ? (<><PurchaseHeader title="Report issue" showBack onBack={() => setScreen('receive-check')} goHome={goHome} /><ReceiveIssue issueLine={issueLine} issuePhoto={issuePhoto} setIssuePhoto={setIssuePhoto} submitIssue={submitIssue} /></>
      ) : screen === 'suppliers' ? (<><PurchaseHeader title="Place Order" subtitle={locName} showBack onBack={() => setScreen('dashboard')} goHome={goHome} /><SupplierList suppliers={suppliers} supplierSearch={supplierSearch} setSupplierSearch={setSupplierSearch} loading={loading} isAdmin={isAdmin} runSeed={runSeed} seedMsg={seedMsg} openGuide={openGuide} /></>
      ) : screen === 'cart' ? (<><PurchaseHeader title="Cart" subtitle={`${locName} \u2022 ${cartTotal.items} items`} showBack onBack={() => setScreen('dashboard')} goHome={goHome} /><CartView carts={carts} deliveryDate={deliveryDate} setDeliveryDate={setDeliveryDate} orderNote={orderNote} setOrderNote={setOrderNote} calcCartTax={calcCartTax} updateCartQty={updateCartQty} openCartNumpad={openCartNumpad} removeCartItem={removeCartItem} setReviewCart={setReviewCart} setScreen={setScreen} /></>
      ) : screen === 'receive-list' ? (<><PurchaseHeader title="Receive" subtitle={locName} showBack onBack={() => setScreen('dashboard')} goHome={goHome} /><ReceiveList pendingDeliveries={pendingDeliveries} openReceiveCheck={openReceiveCheck} /></>
      ) : screen === 'history' ? (<><PurchaseHeader title="Order History" subtitle={locName} showBack onBack={() => setScreen('dashboard')} goHome={goHome} /><HistoryView orders={orders} historyFilter={historyFilter} setHistoryFilter={setHistoryFilter} openOrderDetail={openOrderDetail} /></>
      ) : (<><PurchaseHeader title="Purchase" subtitle="Order from your suppliers" rightElement={locDropdown} goHome={goHome} />
        <PurchaseAlerts suppliers={suppliers} />
        <OrdersDashboard cartItemCount={cartTotal.items} pendingDeliveryCount={pendingDeliveries.length} onNavigate={changeTab} isManager={isManager} onManage={() => setScreen('manage')} locationName={locName} locationId={locationId} />
      </>)}
      <Numpad open={numpadOpen} value={numpadValue} onChange={setNumpadValue} label={numpadProduct?.product_name} sublabel={numpadProduct?.product_uom} onConfirm={handleNumpadConfirm} onClose={() => { setNumpadOpen(false); setRecvNumpadLineId(0); setCartNumpadItem(null); }} />
      {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmLabel={confirmDialog.confirmLabel} cancelLabel={confirmDialog.cancelLabel} variant={confirmDialog.variant} onConfirm={confirmDialog.onConfirm} onCancel={confirmDialog.onCancel || (() => setConfirmDialog(null))} />}
    </div>
  );
}
