'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useCompany } from '@/lib/company-context';
import AppHeader from '@/components/ui/AppHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Numpad from '@/components/ui/Numpad';
import OrdersDashboard from '@/components/purchase/OrdersDashboard';
import PdfViewer from '@/components/ui/PdfViewer';
import PurchaseAlerts from '@/components/purchase/PurchaseAlerts';
import StatusBadge from '@/components/purchase/StatusBadge';
import OrderSentScreen from '@/components/purchase/OrderSentScreen';
import OrderHistoryScreen from '@/components/purchase/OrderHistoryScreen';
import SearchInput from '@/components/purchase/SearchInput';
import OrderGuideScreen from '@/components/purchase/OrderGuideScreen';
import ManageGuideScreen from '@/components/purchase/ManageGuideScreen';
import ReceiveListScreen from '@/components/purchase/ReceiveListScreen';
import ReceiveCheckScreen from '@/components/purchase/ReceiveCheckScreen';
import ReceiveIssueScreen from '@/components/purchase/ReceiveIssueScreen';
import CartViewScreen from '@/components/purchase/CartViewScreen';
import ReviewOrderScreen from '@/components/purchase/ReviewOrderScreen';
import SupplierListScreen from '@/components/purchase/SupplierListScreen';
import OrderDetailScreen from '@/components/purchase/OrderDetailScreen';
import ManagePurchasesScreen from '@/components/purchase/ManagePurchasesScreen';
import AddSupplierScreen from '@/components/purchase/AddSupplierScreen';
import CreateProductSheet from '@/components/purchase/CreateProductSheet';
import CatalogScreen from '@/components/purchase/CatalogScreen';
import InsightsScreen from '@/components/purchase/InsightsScreen';

// Types
interface Supplier { id: number; name: string; email: string; phone?: string; product_count: number; order_days: string; delivery_days?: string; lead_time_days: number; min_order_value: number; approval_required: number; send_method: string; }
interface GuideItem { id: number; product_id: number; product_name: string; product_uom: string; price: number; price_source: string; category_name: string; par_level?: number; product_code?: string; }
interface CartSummary { id: number; supplier_id: number; supplier_name: string; item_count: number; total: number; items: any[]; send_method: string; min_order_value: number; approval_required: number; }
interface Order { id: number; supplier_id: number; supplier_name: string; odoo_po_name: string | null; status: string; total_amount: number; created_at: string; lines?: any[]; delivery_date: string | null; order_note: string; location_id: number; sent_at?: string | null; cancelled_at?: string | null; receipt_status?: string | null; receipt_created_at?: string | null; receipt_confirmed_at?: string | null; approved_by?: number | null; }
interface ReceiptLine { id: number; product_id: number; product_name: string; product_uom: string; ordered_qty: number; received_qty: number | null; difference: number; has_issue: number; issue_type: string | null; issue_notes: string | null; price?: number; subtotal?: number; issue_photo?: string | null; }
interface OdooProduct { id: number; name: string; uom: string; category_name: string; price: number; }

type Tab = 'order' | 'cart' | 'receive' | 'history';
type Screen = 'dashboard' | 'suppliers' | 'guide' | 'cart' | 'review' | 'sent' | 'receive-list' | 'receive-check' | 'receive-issue' | 'history' | 'order-detail' | 'manage' | 'manage-guide' | 'add-supplier' | 'catalog' | 'insights';

interface OdooPartnerResult { odoo_id: number; name: string; email: string; phone: string; already_added: boolean; }
interface CatalogOption { item_id: number; product_id: number; product_name: string; product_uom: string; price: number; category_name: string; supplier_id: number; supplier_name: string; }
interface CatalogGroup { product_id: number; product_name: string; product_uom: string; category_name: string; options: CatalogOption[]; }
interface AnalyticsPayload {
  month: string; prev_month: string;
  month_total: number; month_orders: number; prev_month_total: number;
  delta_abs: number; delta_pct: number | null;
  top_suppliers: { supplier_id: number; supplier_name: string; total: number; orders: number }[];
  top_categories: { category_name: string; total: number }[];
}

export default function PurchasePage() {
  const router = useRouter();
  // The global CompanyContext (top-right selector in AppTopBar) is the single
  // source of truth for which site we're on. stockLocationId matches the
  // legacy SSAM=32 / GBM38=22 convention used throughout the purchase module.
  const { current: currentCompany, stockLocationId, warehouseCode } = useCompany();
  const [tab, setTab] = useState<Tab>('order');
  const [screen, setScreen] = useState<Screen>('dashboard');
  const locationId = stockLocationId || 32;
  const [autoImportBusy, setAutoImportBusy] = useState(false);
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
  const [mgCatOptions, setMgCatOptions] = useState<{ id: number; name: string }[]>([]);
  const [mgUnits, setMgUnits] = useState<{ id: number; name: string }[]>([]);
  const [mgCreateOpen, setMgCreateOpen] = useState(false);
  const [mgCreateSaving, setMgCreateSaving] = useState(false);
  const [mgCreateErr, setMgCreateErr] = useState('');
  const [mgSearching, setMgSearching] = useState(false);
  const [mgAdding, setMgAdding] = useState<number>(0);
  const mgDebounce = useRef<NodeJS.Timeout | null>(null);

  // Supplier config editing state (Manage screen)
  const [mgOrderDays, setMgOrderDays] = useState<string[]>([]);
  const [mgDeliveryDays, setMgDeliveryDays] = useState<string[]>([]);
  const [mgLeadTime, setMgLeadTime] = useState(1);
  const [mgConfigSaving, setMgConfigSaving] = useState(false);
  const [mgConfigOpen, setMgConfigOpen] = useState(false);
  const [mgConfigSaved, setMgConfigSaved] = useState(false);
  const [mgName, setMgName] = useState('');
  const [mgEmail, setMgEmail] = useState('');
  const [mgPhone, setMgPhone] = useState('');
  const [mgSendMethod, setMgSendMethod] = useState('email');
  const mgCfgRef = useRef({ order: [] as string[], delivery: [] as string[], lead: 1, name: '', email: '', phone: '', send: 'email' });
  const mgSaveTimer = useRef<NodeJS.Timeout | null>(null);

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

  // Clear per-location caches when the location changes so stale products
  // from the previous location don't bleed into search results / tax totals.
  useEffect(() => {
    setTaxRates({});
    setAddResults([]);
    setMgResults([]);
    setCatGroups([]);
    setAddSearch('');
    setMgSearch('');
    setCatSearch('');
  }, [locationId]);
  useEffect(() => { if ((tab === 'cart' || screen === 'review') && carts.length > 0) { const ids = carts.flatMap(c => c.items.map((i: any) => i.product_id)); if (ids.length > 0) fetchTaxRates(ids); } }, [tab, screen, carts, fetchTaxRates]);

  function goHome() { router.push('/'); }

  // Parse a supplier's stored order_days JSON. Kept at parent scope so the
  // extracted OrderGuideScreen stays supplier-type-agnostic.
  function parseSupplierOrderDays(supplierId: number): string[] {
    const supplier = suppliers.find((s) => s.id === supplierId);
    try { return JSON.parse(supplier?.order_days || '[]'); } catch { return []; }
  }

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

  // Wraps sendOrder with the confirm-dialog copy the Review screen used to own.
  function requestSendOrder(cart: CartSummary) {
    const { net, gross } = calcCartTax(cart);
    const belowMin = cart.min_order_value > 0 && net < cart.min_order_value;
    setConfirmDialog({
      title: belowMin ? 'Below minimum order' : 'Send order?',
      message: belowMin
        ? `This order (\u20ac${net.toFixed(2)} net) is below the minimum of \u20ac${cart.min_order_value.toFixed(2)}. Send anyway to ${cart.supplier_name}?`
        : `Send ${cart.item_count} items (\u20ac${gross.toFixed(2)} incl. tax) to ${cart.supplier_name}?`,
      confirmLabel: belowMin ? 'Send anyway' : 'Yes, send order',
      variant: 'primary',
      onConfirm: () => { setConfirmDialog(null); sendOrder(cart); },
    });
  }

  async function removeCartItem(cartId: number, productId: number) {
    await fetch('/api/purchase/cart', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart_id: cartId, product_id: productId }) });
    fetchCart();
  }

  async function discardCart(cartId: number) {
    await fetch('/api/purchase/cart', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cart_id: cartId }) });
    fetchCart();
  }

  function requestDiscardCart(cart: CartSummary) {
    setConfirmDialog({
      title: 'Discard this order?',
      message: `This empties your ${cart.supplier_name} cart (${cart.item_count} items). Nothing has been sent to the supplier yet. This cannot be undone.`,
      confirmLabel: 'Yes, discard',
      variant: 'danger',
      onConfirm: () => { setConfirmDialog(null); discardCart(cart.id); },
    });
  }

  async function openReceiveCheck(order: { id: number }) {
    setScreen('receive-check');
    setDeliveryPhotos([]);
    try { const r = await fetch(`/api/purchase/receive?order_id=${order.id}`); const d = await r.json(); setReceipt(d.receipt); setReceiptLines(d.receipt?.lines || []); setRecvOrder(d.order || null); } catch (e) { void e; }
  }

  async function updateRecvQty(lineId: number, qty: number) {
    setReceiptLines(prev => prev.map(l => l.id === lineId ? { ...l, received_qty: qty, difference: qty - l.ordered_qty } : l));
    await fetch('/api/purchase/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_line', line_id: lineId, received_qty: qty }) });
  }

  function openIssueReport(line: ReceiptLine) { setIssueLine(line); setIssueLineId(line.id); setScreen('receive-issue'); }

  function openRecvNumpadForLine(line: ReceiptLine) {
    setRecvNumpadLineId(line.id);
    setCartNumpadItem(null);
    setNumpadProduct({ id: 0, product_id: line.product_id, product_name: line.product_name, product_uom: line.product_uom, price: line.price || 0, price_source: '', category_name: '' });
    setNumpadValue(line.received_qty !== null ? String(line.received_qty) : '');
    setNumpadOpen(true);
  }

  async function submitIssue(issueType: string, notes: string, photo?: string) {
    await fetch('/api/purchase/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_line', line_id: issueLineId, has_issue: 1, issue_type: issueType, issue_notes: notes, issue_photo: photo || null }) });
    setReceiptLines(prev => prev.map(l => l.id === issueLineId ? { ...l, has_issue: 1, issue_type: issueType, issue_notes: notes } : l));
    setScreen('receive-check');
  }

  async function confirmReceiptAction(closeOrder: boolean) {
    if (!receipt) return;
    await fetch('/api/purchase/receive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm', receipt_id: receipt.id, close_order: closeOrder }) });
    fetchPending(); setScreen('receive-list');
  }

  async function openOrderDetail(order: { id: number }) { try { const r = await fetch(`/api/purchase/orders?id=${order.id}`); const d = await r.json(); setSelectedOrder(d.order); setScreen('order-detail'); } catch (e) { void e; } }

  async function cancelSelectedOrder() {
    if (!selectedOrder) return;
    await fetch('/api/purchase/orders/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: selectedOrder.id }) });
    fetchOrders(); setScreen('history');
  }

  async function openManageGuide(supplier: Supplier) {
    setGuideSupplierId(supplier.id); setGuideSupplierName(supplier.name); setMgSearch(''); setMgCategory('All'); setMgResults([]); setScreen('manage-guide'); setMgConfigOpen(false);
    // Populate supplier config
    let od: string[] = []; try { od = JSON.parse(supplier.order_days || '[]'); } catch { od = []; }
    let dd: string[] = []; try { dd = JSON.parse(supplier.delivery_days || '[]'); } catch { dd = []; }
    const lt = supplier.lead_time_days || 1;
    const sName = supplier.name || ''; const sEmail = supplier.email || '';
    const sPhone = (supplier as { phone?: string }).phone || ''; const sSend = supplier.send_method || 'email';
    setMgOrderDays(od); setMgDeliveryDays(dd); setMgLeadTime(lt);
    setMgName(sName); setMgEmail(sEmail); setMgPhone(sPhone); setMgSendMethod(sSend);
    mgCfgRef.current = { order: od, delivery: dd, lead: lt, name: sName, email: sEmail, phone: sPhone, send: sSend };
    setMgConfigSaved(false);
    try { const r = await fetch(`/api/purchase/guides?supplier_id=${supplier.id}&location_id=${locationId}`); const d = await r.json(); setGuideItems(d.guide?.items || []); } catch (e) { void e; setGuideItems([]); }
    try { const r = await fetch('/api/purchase/products?q=&limit=1'); const d = await r.json(); setMgCategories((d.categories || []).map((c: any) => c.name)); setMgCatOptions((d.categories || []).map((c: any) => ({ id: c.id, name: c.name }))); setMgUnits(d.units || []); } catch (e) { void e; }
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

  async function addProductToGuide(product: OdooProduct & { product_code?: string }, extra?: { par_level?: number; product_code?: string }) {
    setMgAdding(product.id);
    try { await fetch('/api/purchase/guides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ supplier_id: guideSupplierId, location_id: locationId, product_id: product.id, product_name: product.name, product_uom: product.uom, price: product.price, price_source: 'odoo', category_name: product.category_name, par_level: extra?.par_level ?? 0, product_code: extra?.product_code ?? product.product_code ?? '' }) }); const r = await fetch(`/api/purchase/guides?supplier_id=${guideSupplierId}&location_id=${locationId}`); const d = await r.json(); setGuideItems(d.guide?.items || []); fetchSuppliers(); } catch (e) { void e; } finally { setMgAdding(0); }
  }

  async function createProductAndAddToGuide(payload: { name: string; uom_id: number; price: number; categ_id: number; default_code: string; par_level: number }) {
    setMgCreateSaving(true); setMgCreateErr('');
    try {
      const r = await fetch('/api/purchase/products/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to create product');
      await addProductToGuide(d.product, { par_level: payload.par_level, product_code: d.product.product_code });
      setMgCreateOpen(false);
    } catch (e: any) { setMgCreateErr(e.message || 'Failed to create product'); }
    finally { setMgCreateSaving(false); }
  }

  async function removeGuideItemAction(itemId: number) { await fetch(`/api/purchase/guides?item_id=${itemId}`, { method: 'DELETE' }); setGuideItems(prev => prev.filter(i => i.id !== itemId)); fetchSuppliers(); }

  async function deleteSupplier(supplier: Supplier) {
    try {
      await fetch(`/api/purchase/suppliers?id=${supplier.id}`, { method: 'DELETE' });
      fetchSuppliers();
    } catch (e) { console.error('[purchase] deleteSupplier failed', e); }
  }

  // Confirm-dialog wrappers the screens call — kept in parent so dialog copy
  // stays with the rest of the router-level state.
  function requestDeleteSupplier(s: Supplier) {
    setConfirmDialog({
      title: `Delete ${s.name}?`,
      message: s.product_count > 0
        ? `This removes ${s.name} and their order guide (${s.product_count} products) from your list. Past orders stay in history. This cannot be undone.`
        : `This removes ${s.name} from your list. You can seed suppliers from Odoo again later to restore. This cannot be undone.`,
      confirmLabel: 'Yes, delete',
      variant: 'danger',
      onConfirm: () => { setConfirmDialog(null); deleteSupplier(s); },
    });
  }

  function requestReorder(order: Order) {
    if (!order.lines || order.lines.length === 0) return;
    setConfirmDialog({
      title: 'Reorder these items?',
      message: `This adds all ${order.lines.length} items to your ${order.supplier_name} cart at the original quantities. Items already in your cart will have their quantity updated to match this order.`,
      confirmLabel: reordering ? 'Adding...' : 'Yes, add to cart',
      variant: 'primary',
      onConfirm: () => { setConfirmDialog(null); reorderPastOrder(order); },
    });
  }

  function requestCancelOrder(order: Order) {
    setConfirmDialog({
      title: 'Cancel this order?',
      message: `Are you sure you want to cancel this order to ${order.supplier_name}? This cannot be undone.`,
      confirmLabel: 'Yes, cancel order',
      variant: 'danger',
      onConfirm: () => { setConfirmDialog(null); cancelSelectedOrder(); },
    });
  }

  // ── Add Supplier state ─────────────────────────────────────
  const [addMode, setAddMode] = useState<'odoo' | 'new'>('odoo');
  const [addSearch, setAddSearch] = useState('');
  const [addAll, setAddAll] = useState<OdooPartnerResult[]>([]);          // full supplier list from Odoo
  const [addResults, setAddResults] = useState<OdooPartnerResult[]>([]);  // filtered view shown to the user
  const [addSearching, setAddSearching] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');

  function resetAddForm() {
    setAddMode('odoo'); setAddSearch(''); setAddAll([]); setAddResults([]); setAddSearching(false);
    setAddSaving(false); setAddErr(''); setNewName(''); setNewEmail(''); setNewPhone('');
  }

  // Load the full active-supplier list once so the "Pick from Odoo" tab shows a
  // browsable list by default (~149 suppliers). Filtering is then client-side/instant.
  async function loadAllSuppliers() {
    setAddSearching(true);
    try {
      const r = await fetch('/api/purchase/suppliers/search?q=&limit=200');
      const d = await r.json();
      const list: OdooPartnerResult[] = d.suppliers || [];
      setAddAll(list);
      setAddResults(list);
    } catch (e) {
      console.error('[purchase] loadAllSuppliers failed', e);
      setAddAll([]); setAddResults([]);
    } finally {
      setAddSearching(false);
    }
  }

  function filterSuppliers(q: string) {
    setAddSearch(q);
    const needle = q.trim().toLowerCase();
    setAddResults(needle ? addAll.filter((s) => s.name.toLowerCase().includes(needle)) : addAll);
  }

  async function linkOdooPartner(p: OdooPartnerResult) {
    setAddSaving(true); setAddErr('');
    try {
      const r = await fetch('/api/purchase/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ odoo_partner_id: p.odoo_id, name: p.name, email: p.email, phone: p.phone, location_id: locationId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to add supplier');
      await fetchSuppliers();
      resetAddForm();
      setScreen('manage');
    } catch (e: any) { setAddErr(e.message || 'Failed'); }
    finally { setAddSaving(false); }
  }

  // ── Catalog browse state ───────────────────────────────────
  const [catSearch, setCatSearch] = useState('');
  const [catGroups, setCatGroups] = useState<CatalogGroup[]>([]);
  const [catSearching, setCatSearching] = useState(false);
  const [catAddingId, setCatAddingId] = useState<number>(0);
  const catDebounce = useRef<NodeJS.Timeout | null>(null);

  function searchCatalog(q: string) {
    setCatSearch(q);
    if (catDebounce.current) clearTimeout(catDebounce.current);
    if (q.trim().length < 2) { setCatGroups([]); setCatSearching(false); return; }
    setCatSearching(true);
    catDebounce.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/purchase/catalog?q=${encodeURIComponent(q)}&location_id=${locationId}&limit=150`);
        const d = await r.json();
        setCatGroups(d.groups || []);
      } catch (e) { console.error('[purchase] searchCatalog failed', e); setCatGroups([]); }
      finally { setCatSearching(false); }
    }, 250);
  }

  // ── Delivery note (staff capture) + submit / manager approve ─
  const [deliveryPhotos, setDeliveryPhotos] = useState<string[]>([]);
  const [submittingReceipt, setSubmittingReceipt] = useState(false);
  const [notePdf, setNotePdf] = useState<string | null>(null);

  const [reordering, setReordering] = useState(false);
  async function reorderPastOrder(order: Order) {
    if (!order.lines || order.lines.length === 0) return;
    setReordering(true);
    try {
      for (const line of order.lines) {
        await fetch('/api/purchase/cart', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            location_id: order.location_id,
            supplier_id: order.supplier_id,
            product_id: line.product_id,
            quantity: line.quantity,
            product_name: line.product_name,
            product_uom: line.product_uom,
            price: line.price,
          }),
        });
      }
      await fetchCart();
      changeTab('cart');
    } catch (e) { console.error('[purchase] reorderPastOrder failed', e); }
    finally { setReordering(false); }
  }

  function addDeliveryPhoto(dataUrl: string) {
    if (dataUrl.startsWith('data:image/')) setDeliveryPhotos(prev => [...prev, dataUrl]);
  }

  function removeDeliveryPhoto(index: number) {
    setDeliveryPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function submitReceiptForApproval() {
    if (!receipt || deliveryPhotos.length === 0) return;
    setSubmittingReceipt(true);
    try {
      const r = await fetch('/api/purchase/receive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', receipt_id: receipt.id, photos: deliveryPhotos }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setConfirmDialog({ title: 'Could not submit', message: d.error || 'Please try again.', confirmLabel: 'OK', variant: 'primary', onConfirm: () => setConfirmDialog(null) });
        return;
      }
      setDeliveryPhotos([]);
      fetchPending();
      setScreen('receive-list');
    } catch (e) { void e; }
    finally { setSubmittingReceipt(false); }
  }

  async function viewDeliveryNote() {
    if (!receipt) return;
    try {
      const r = await fetch(`/api/purchase/receive?note_pdf=${receipt.id}`);
      const d = await r.json();
      // PdfViewer expects raw base64 (it calls atob directly) — strip the data-URL prefix.
      if (d.pdf) setNotePdf(String(d.pdf).replace(/^data:[^;]+;base64,/, ''));
    } catch (e) { void e; }
  }

  // ── Insights state ──────────────────────────────────────────
  const [insightsMonth, setInsightsMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [insights, setInsights] = useState<AnalyticsPayload | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const fetchInsights = useCallback(async (month: string) => {
    setInsightsLoading(true);
    try {
      const r = await fetch(`/api/purchase/analytics?location_id=${locationId}&month=${month}`);
      const d = await r.json();
      if (r.ok) setInsights(d); else setInsights(null);
    } catch (e) { console.error('[purchase] fetchInsights failed', e); setInsights(null); }
    finally { setInsightsLoading(false); }
  }, [locationId]);

  useEffect(() => { if (screen === 'insights') fetchInsights(insightsMonth); }, [screen, insightsMonth, fetchInsights]);

  function shiftInsightsMonth(delta: number) {
    const [y, m] = insightsMonth.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setInsightsMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }

  function formatMonth(ym: string) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  async function addCatalogOptionToCart(opt: CatalogOption) {
    setCatAddingId(opt.item_id);
    try {
      await fetch('/api/purchase/cart', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          supplier_id: opt.supplier_id,
          product_id: opt.product_id,
          quantity: 1,
          product_name: opt.product_name,
          product_uom: opt.product_uom,
          price: opt.price,
        }),
      });
      fetchCart();
    } catch (e) { console.error('[purchase] addCatalogOptionToCart failed', e); }
    finally { setCatAddingId(0); }
  }

  async function createNewSupplierInOdoo() {
    if (!newName.trim()) { setAddErr('Name is required'); return; }
    setAddSaving(true); setAddErr('');
    try {
      const r = await fetch('/api/purchase/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ create_in_odoo: true, name: newName.trim(), email: newEmail.trim(), phone: newPhone.trim(), location_id: locationId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to create supplier');
      await fetchSuppliers();
      resetAddForm();
      setScreen('manage');
    } catch (e: any) { setAddErr(e.message || 'Failed'); }
    finally { setAddSaving(false); }
  }

  // Save-as-you-go: persist delivery settings on every change (debounced), so
  // there is no separate "Save" button. mgCfgRef holds the latest values to
  // avoid stale-closure reads inside the debounced timer.
  function persistSupplierConfig(next: Partial<{ order: string[]; delivery: string[]; lead: number; name: string; email: string; phone: string; send: string }>) {
    mgCfgRef.current = { ...mgCfgRef.current, ...next };
    if (mgSaveTimer.current) clearTimeout(mgSaveTimer.current);
    setMgConfigSaving(true); setMgConfigSaved(false);
    mgSaveTimer.current = setTimeout(async () => {
      const cfg = mgCfgRef.current;
      try {
        await fetch('/api/purchase/suppliers', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: guideSupplierId,
            order_days: JSON.stringify(cfg.order),
            delivery_days: JSON.stringify(cfg.delivery),
            lead_time_days: cfg.lead,
            email: cfg.email,
            phone: cfg.phone,
            send_method: cfg.send,
            // Only persist name when non-empty so a mid-edit blank never wipes it.
            ...(cfg.name.trim() ? { name: cfg.name.trim() } : {}),
          }),
        });
        fetchSuppliers();
        setMgConfigSaved(true);
      } catch (e) { void e; }
      finally { setMgConfigSaving(false); }
    }, 600);
  }

  async function runSeed() { setSeedMsg('Seeding...'); try { const r = await fetch('/api/purchase/seed', { method: 'POST' }); const d = await r.json(); setSeedMsg(d.message || 'Done'); fetchSuppliers(); } catch (e: any) { setSeedMsg(`Error: ${e.message}`); } }

  async function runAutoImport() {
    setAutoImportBusy(true);
    setSeedMsg('Reading Odoo order history…');
    try {
      const r = await fetch('/api/purchase/auto-discover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) {
        setSeedMsg(`Error: ${d.error || 'Failed'}`);
        return;
      }
      const lines = (d.results || []).map((x: any) => {
        if (x.error) return `${x.company_name}: ${x.error}`;
        if (x.po_count === 0) return `${x.company_name} → ${x.location_name || '?'}: no orders in window`;
        return `${x.company_name} → ${x.location_name}: ${x.suppliers_imported} new + ${x.suppliers_reused} existing supplier(s), ${x.items_added} products added${x.items_refreshed ? `, ${x.items_refreshed} price refresh` : ''}`;
      });
      setSeedMsg(lines.join('\n') || d.message || 'Done');
      fetchSuppliers();
    } catch (e: any) {
      setSeedMsg(`Error: ${e.message}`);
    } finally {
      setAutoImportBusy(false);
    }
  }

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
  const locName = warehouseCode || currentCompany?.name || 'SSAM';

  // Local Header is now a thin wrapper around AppHeader so the canonical
  // back-button location, size and design is shared across the portal.
  const Header = ({ title, subtitle, showBack, onBack, rightElement }: { title: string; subtitle?: string; showBack?: boolean; onBack?: () => void; rightElement?: React.ReactNode }) => (
    <AppHeader title={title} subtitle={subtitle} showBack={showBack} onBack={onBack} action={rightElement} />
  );

  const manageIconBtn = (
    <button
      onClick={() => setScreen('manage')}
      title="Order Templates"
      aria-label="Order Templates"
      className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-white/80 active:bg-white/20 transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
      </svg>
    </button>
  );



  // ============== RENDER ==============
  return (
    <div className="min-h-screen bg-gray-50">
      {screen === 'guide' ? (<><Header title={guideSupplierName} subtitle={`${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => setScreen('dashboard')} />
        <OrderGuideScreen
          items={guideItems}
          search={guideSearch}
          category={guideCategory}
          quantities={quantities}
          supplierOrderDays={parseSupplierOrderDays(guideSupplierId)}
          locationName={locName}
          onSearchChange={setGuideSearch}
          onCategoryChange={setGuideCategory}
          onUpdateQty={(item, qty) => updateCartQty(item, qty)}
          onOpenNumpad={openNumpad}
          onViewCart={() => changeTab('cart')}
        /></>
      ) : screen === 'manage' ? (<><Header title="Order Templates" subtitle="Your reusable order lists & suppliers" showBack onBack={() => setScreen('dashboard')} />
        <ManagePurchasesScreen
          suppliers={suppliers}
          isAdmin={isAdmin}
          seedMsg={seedMsg}
          autoImportBusy={autoImportBusy}
          onAddSupplier={() => { resetAddForm(); setScreen('add-supplier'); loadAllSuppliers(); }}
          onInsights={() => setScreen('insights')}
          onOpenGuide={openManageGuide}
          onRequestDelete={requestDeleteSupplier}
          onSeed={runSeed}
          onAutoImport={runAutoImport}
        /></>
      ) : screen === 'add-supplier' ? (<><Header title="Add supplier" subtitle="Link from Odoo or create new" showBack onBack={() => { resetAddForm(); setScreen('manage'); }} />
        <AddSupplierScreen
          mode={addMode}
          onModeChange={(m) => { setAddMode(m); setAddErr(''); if (m === 'odoo' && addAll.length === 0) loadAllSuppliers(); }}
          errorMsg={addErr}
          search={addSearch}
          results={addResults}
          searching={addSearching}
          saving={addSaving}
          onSearchChange={filterSuppliers}
          onLinkPartner={linkOdooPartner}
          newName={newName}
          newEmail={newEmail}
          newPhone={newPhone}
          onNewNameChange={setNewName}
          onNewEmailChange={setNewEmail}
          onNewPhoneChange={setNewPhone}
          onCreateNew={createNewSupplierInOdoo}
        /></>
      ) : screen === 'insights' ? (<><Header title="Insights" subtitle={`${locName} \u2022 spend & trends`} showBack onBack={() => setScreen('manage')} />
        <InsightsScreen
          month={insightsMonth}
          data={insights}
          loading={insightsLoading}
          onShiftMonth={shiftInsightsMonth}
          formatMonth={formatMonth}
        /></>
      ) : screen === 'catalog' ? (<><Header title="Catalog" subtitle={`${locName} \u2022 across all suppliers`} showBack onBack={() => setScreen('suppliers')} />
        <CatalogScreen
          search={catSearch}
          groups={catGroups}
          searching={catSearching}
          addingId={catAddingId}
          locationName={locName}
          onSearchChange={searchCatalog}
          onAddToCart={addCatalogOptionToCart}
        /></>
      ) : screen === 'manage-guide' ? (<><Header title={guideSupplierName} subtitle={`Edit guide \u2022 ${locName} \u2022 ${guideItems.length} products`} showBack onBack={() => setScreen('manage')} />
        <ManageGuideScreen
          items={guideItems}
          configOpen={mgConfigOpen}
          orderDays={mgOrderDays}
          deliveryDays={mgDeliveryDays}
          leadTime={mgLeadTime}
          configSaving={mgConfigSaving}
          configSaved={mgConfigSaved}
          onToggleConfig={() => setMgConfigOpen(!mgConfigOpen)}
          onOrderDaysChange={(days) => { setMgOrderDays(days); persistSupplierConfig({ order: days }); }}
          onDeliveryDaysChange={(days) => { setMgDeliveryDays(days); persistSupplierConfig({ delivery: days }); }}
          onLeadTimeChange={(n) => { setMgLeadTime(n); persistSupplierConfig({ lead: n }); }}
          name={mgName}
          email={mgEmail}
          phone={mgPhone}
          sendMethod={mgSendMethod}
          onNameChange={(v) => { setMgName(v); if (v.trim()) setGuideSupplierName(v); persistSupplierConfig({ name: v }); }}
          onEmailChange={(v) => { setMgEmail(v); persistSupplierConfig({ email: v }); }}
          onPhoneChange={(v) => { setMgPhone(v); persistSupplierConfig({ phone: v }); }}
          onSendMethodChange={(v) => { setMgSendMethod(v); persistSupplierConfig({ send: v }); }}
          search={mgSearch}
          category={mgCategory}
          searching={mgSearching}
          addingId={mgAdding}
          results={mgResults}
          categories={mgCategories}
          onSearchChange={(q) => searchProducts(q, mgCategory)}
          onCategoryChange={handleMgCategoryChange}
          onClearSearch={() => { setMgSearch(''); setMgResults([]); }}
          onAddProduct={addProductToGuide}
          onRemoveItem={removeGuideItemAction}
          onCreateNew={() => setMgCreateOpen(true)}
        />
        <CreateProductSheet
          open={mgCreateOpen}
          initialName={mgSearch}
          units={mgUnits}
          categories={mgCatOptions}
          saving={mgCreateSaving}
          error={mgCreateErr}
          onClose={() => { setMgCreateOpen(false); setMgCreateErr(''); }}
          onCreate={createProductAndAddToGuide}
        /></>
      ) : screen === 'review' ? (<><Header title="Review order" subtitle={reviewCart?.supplier_name} showBack onBack={() => { setScreen('cart'); }} />
        {reviewCart && (
          <ReviewOrderScreen
            cart={reviewCart}
            deliveryDate={deliveryDate}
            orderNote={orderNote}
            locationName={locName}
            calcTax={calcCartTax}
            sending={sending}
            onSend={requestSendOrder}
          />
        )}</>
      ) : screen === 'sent' ? (<><Header title="Purchase" /><OrderSentScreen onPlaceAnother={() => changeTab('order')} onHistory={() => changeTab('history')} onHome={goHome} /></>
      ) : screen === 'order-detail' ? (<><Header title="Order details" showBack onBack={() => { setScreen('history'); }} />
        <OrderDetailScreen
          order={selectedOrder}
          reordering={reordering}
          onReorder={requestReorder}
          onCancel={requestCancelOrder}
        /></>
      ) : screen === 'receive-check' ? (<><Header title={recvOrder?.supplier_name || 'Receive'} subtitle={recvOrder?.odoo_po_name || ''} showBack onBack={() => { setScreen('receive-list'); }} />
        <ReceiveCheckScreen
          order={recvOrder}
          lines={receiptLines}
          isManager={isManager}
          isSubmitted={receipt?.status === 'submitted'}
          deliveryPhotos={deliveryPhotos}
          submitting={submittingReceipt}
          onAddPhoto={addDeliveryPhoto}
          onRemovePhoto={removeDeliveryPhoto}
          onSubmit={() => setConfirmDialog({ title: 'Submit for approval?', message: 'This sends the delivery to a manager to approve. You cannot edit it after submitting.', confirmLabel: 'Yes, submit', variant: 'primary', onConfirm: () => { setConfirmDialog(null); submitReceiptForApproval(); } })}
          onViewNote={viewDeliveryNote}
          onUpdateQty={updateRecvQty}
          onOpenNumpad={openRecvNumpadForLine}
          onReportIssue={openIssueReport}
          onConfirmClose={() => setConfirmDialog({ title: 'Approve receipt?', message: 'This will update stock quantities in Odoo and close this order. This cannot be undone.', confirmLabel: 'Yes, approve & close', variant: 'primary', onConfirm: () => { setConfirmDialog(null); confirmReceiptAction(true); } })}
          onKeepBackorder={() => setConfirmDialog({ title: 'Keep as backorder?', message: 'Received quantities will be updated in Odoo. The remaining items will stay open for a future delivery.', confirmLabel: 'Yes, keep backorder', variant: 'primary', onConfirm: () => { setConfirmDialog(null); confirmReceiptAction(false); } })}
        /></>
      ) : screen === 'receive-issue' ? (<><Header title="Report issue" showBack onBack={() => setScreen('receive-check')} />
        <ReceiveIssueScreen line={issueLine} onSubmit={submitIssue} /></>
      ) : screen === 'suppliers' ? (<><Header title="Place Order" subtitle={locName} showBack onBack={() => setScreen('dashboard')} />
        <SupplierListScreen
          suppliers={suppliers}
          search={supplierSearch}
          loading={loading}
          isAdmin={isAdmin}
          seedMsg={seedMsg}
          onSearchChange={setSupplierSearch}
          onBrowseCatalog={() => { setCatSearch(''); setCatGroups([]); setScreen('catalog'); }}
          onOpen={openGuide}
          onSeed={runSeed}
        /></>
      ) : screen === 'cart' ? (<><Header title="Cart" subtitle={`${locName} \u2022 ${cartTotal.items} items`} showBack onBack={() => setScreen('dashboard')} />
        <CartViewScreen
          carts={carts}
          deliveryDate={deliveryDate}
          orderNote={orderNote}
          onDeliveryDateChange={setDeliveryDate}
          onOrderNoteChange={setOrderNote}
          calcTax={calcCartTax}
          onUpdateQty={(product, qty, supplierId) => updateCartQty(product, qty, supplierId)}
          onOpenNumpad={openCartNumpad}
          onRemoveItem={removeCartItem}
          onDiscardCart={requestDiscardCart}
          onReview={(cart) => { setReviewCart(cart); setScreen('review'); }}
        /></>
      ) : screen === 'receive-list' ? (<><Header title="Receive" subtitle={locName} showBack onBack={() => setScreen('dashboard')} />
        <ReceiveListScreen orders={pendingDeliveries} isManager={isManager} onOpen={openReceiveCheck} /></>
      ) : screen === 'history' ? (<><Header title="Order History" subtitle={locName} showBack onBack={() => setScreen('dashboard')} /><OrderHistoryScreen orders={orders} filter={historyFilter} onFilterChange={setHistoryFilter} onOpen={openOrderDetail} /></>
      ) : (<><Header title="Purchase" subtitle="Order from your suppliers" rightElement={isManager ? manageIconBtn : undefined} />
        <PurchaseAlerts suppliers={suppliers} />
        <OrdersDashboard cartItemCount={cartTotal.items} pendingDeliveryCount={pendingDeliveries.length} awaitingApprovalCount={pendingDeliveries.filter((o) => o.receipt_status === 'submitted').length} isManager={isManager} onNavigate={changeTab} onManageTemplates={() => setScreen('manage')} locationId={locationId} />
      </>)}
      <Numpad open={numpadOpen} value={numpadValue} onChange={setNumpadValue} label={numpadProduct?.product_name} sublabel={numpadProduct?.product_uom} onConfirm={handleNumpadConfirm} onClose={() => { setNumpadOpen(false); setRecvNumpadLineId(0); setCartNumpadItem(null); }} />
      {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmLabel={confirmDialog.confirmLabel} cancelLabel={confirmDialog.cancelLabel} variant={confirmDialog.variant} onConfirm={confirmDialog.onConfirm} onCancel={confirmDialog.onCancel || (() => setConfirmDialog(null))} />}
      {notePdf && <PdfViewer fileData={notePdf} fileName="delivery-note.pdf" onClose={() => setNotePdf(null)} />}
    </div>
  );
}
