'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Numpad from '@/components/ui/Numpad';
import OrdersDashboard from '@/components/purchase/OrdersDashboard';
import FilePicker from "@/components/ui/FilePicker";
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
import CatalogScreen from '@/components/purchase/CatalogScreen';
import InsightsScreen from '@/components/purchase/InsightsScreen';

// Types
interface Supplier { id: number; name: string; email: string; product_count: number; order_days: string; delivery_days?: string; lead_time_days: number; min_order_value: number; approval_required: number; send_method: string; }
interface GuideItem { id: number; product_id: number; product_name: string; product_uom: string; price: number; price_source: string; category_name: string; }
interface CartSummary { id: number; supplier_id: number; supplier_name: string; item_count: number; total: number; items: any[]; send_method: string; min_order_value: number; approval_required: number; }
interface Order { id: number; supplier_id: number; supplier_name: string; odoo_po_name: string | null; status: string; total_amount: number; created_at: string; lines?: any[]; delivery_date: string | null; order_note: string; location_id: number; sent_at?: string | null; cancelled_at?: string | null; receipt_status?: string | null; receipt_created_at?: string | null; receipt_confirmed_at?: string | null; approved_by?: number | null; }
interface ReceiptLine { id: number; product_id: number; product_name: string; product_uom: string; ordered_qty: number; received_qty: number | null; difference: number; has_issue: number; issue_type: string | null; issue_notes: string | null; price?: number; subtotal?: number; issue_photo?: string | null; }
interface OdooProduct { id: number; name: string; uom: string; category_name: string; price: number; }

type Tab = 'order' | 'cart' | 'receive' | 'history';
type Screen = 'dashboard' | 'suppliers' | 'guide' | 'cart' | 'review' | 'sent' | 'receive-list' | 'receive-check' | 'receive-issue' | 'history' | 'order-detail' | 'manage' | 'manage-guide' | 'add-supplier' | 'catalog' | 'insights';

interface OdooPartnerResult { odoo_id: number; name: string; email: string; phone: string; already_added: boolean; }
interface CatalogOption { item_id: number; product_id: number; product_name: string; product_uom: string; price: number; category_name: string; supplier_id: number; supplier_name: string; }
interface CatalogGroup { product_id: number; product_name: string; product_uom: string; category_name: string; options: CatalogOption[]; }
interface ScanMatched { line_id: number; product_name: string; received_qty: number; ocr_description: string; ocr_price: number | null; confidence: 'high' | 'medium' | 'low'; price_flag: boolean; }
interface ScanResult {
  ocr_mode: 'mock' | 'azure';
  ocr_error: string | null;
  attachment_id: number | null;
  supplier_name?: string;
  invoice_total?: number;
  matched: ScanMatched[];
  unmatched_ocr: { description: string; quantity: number | null; unit_price: number | null }[];
  missing_ordered: { line_id: number; product_name: string; ordered_qty: number }[];
}
interface AnalyticsPayload {
  month: string; prev_month: string;
  month_total: number; month_orders: number; prev_month_total: number;
  delta_abs: number; delta_pct: number | null;
  top_suppliers: { supplier_id: number; supplier_name: string; total: number; orders: number }[];
  top_categories: { category_name: string; total: number }[];
}

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

  // Supplier config editing state (Manage screen)
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

  async function openReceiveCheck(order: { id: number }) {
    setScreen('receive-check');
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
  const [addResults, setAddResults] = useState<OdooPartnerResult[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const addSearchRef = useRef<NodeJS.Timeout | null>(null);

  function resetAddForm() {
    setAddMode('odoo'); setAddSearch(''); setAddResults([]); setAddSearching(false);
    setAddSaving(false); setAddErr(''); setNewName(''); setNewEmail(''); setNewPhone('');
  }

  function searchOdooPartners(q: string) {
    setAddSearch(q);
    if (addSearchRef.current) clearTimeout(addSearchRef.current);
    if (q.trim().length < 2) { setAddResults([]); setAddSearching(false); return; }
    setAddSearching(true);
    addSearchRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/purchase/suppliers/search?q=${encodeURIComponent(q)}&limit=20`);
        const d = await r.json();
        setAddResults(d.suppliers || []);
      } catch (e) { console.error('[purchase] searchOdooPartners failed', e); setAddResults([]); }
      finally { setAddSearching(false); }
    }, 300);
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

  // ── Scan delivery note state ────────────────────────────────
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanErr, setScanErr] = useState<string>('');

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

  async function scanDeliveryNote(file: File) {
    if (!recvOrder?.id) { setScanErr('Open an order first.'); return; }
    setScanning(true); setScanErr(''); setScanResult(null);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const r = await fetch('/api/purchase/receive/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: recvOrder.id, image_data_url: dataUrl }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Scan failed');
      setScanResult(d);
      // Prefill received_qty for every matched line. UI keeps Issue buttons so the user can still flag problems.
      if (d.matched?.length) {
        for (const m of d.matched as ScanMatched[]) {
          try {
            await fetch('/api/purchase/receive', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'update_line', line_id: m.line_id, received_qty: m.received_qty }),
            });
          } catch (e) { void e; }
        }
        const rr = await fetch(`/api/purchase/receive?order_id=${recvOrder.id}`);
        const rd = await rr.json();
        setReceiptLines(rd.receipt?.lines || []);
      }
    } catch (e: any) { setScanErr(e.message || 'Scan failed'); }
    finally { setScanning(false); }
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

  const manageIconBtn = (
    <button
      onClick={() => setScreen('manage')}
      title="Manage guides & settings"
      aria-label="Manage guides & settings"
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
      ) : screen === 'manage' ? (<><Header title="Manage Purchases" subtitle="Guides, suppliers, settings" showBack onBack={() => setScreen('dashboard')} />
        <ManagePurchasesScreen
          suppliers={suppliers}
          isAdmin={isAdmin}
          seedMsg={seedMsg}
          onAddSupplier={() => { resetAddForm(); setScreen('add-supplier'); }}
          onInsights={() => setScreen('insights')}
          onOpenGuide={openManageGuide}
          onRequestDelete={requestDeleteSupplier}
          onSeed={runSeed}
        /></>
      ) : screen === 'add-supplier' ? (<><Header title="Add supplier" subtitle="Link from Odoo or create new" showBack onBack={() => { resetAddForm(); setScreen('manage'); }} />
        <AddSupplierScreen
          mode={addMode}
          onModeChange={(m) => { setAddMode(m); setAddErr(''); }}
          errorMsg={addErr}
          search={addSearch}
          results={addResults}
          searching={addSearching}
          saving={addSaving}
          onSearchChange={searchOdooPartners}
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
          onToggleConfig={() => setMgConfigOpen(!mgConfigOpen)}
          onOrderDaysChange={setMgOrderDays}
          onDeliveryDaysChange={setMgDeliveryDays}
          onLeadTimeChange={setMgLeadTime}
          onSaveConfig={saveSupplierConfig}
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
          scanning={scanning}
          scanResult={scanResult}
          scanErr={scanErr}
          onScanFile={scanDeliveryNote}
          onDismissScan={() => setScanResult(null)}
          onUpdateQty={updateRecvQty}
          onOpenNumpad={openRecvNumpadForLine}
          onReportIssue={openIssueReport}
          onConfirmClose={() => setConfirmDialog({ title: 'Confirm receipt?', message: 'This will update stock quantities in Odoo and close this order. This cannot be undone.', confirmLabel: 'Yes, confirm & close', variant: 'primary', onConfirm: () => { setConfirmDialog(null); confirmReceiptAction(true); } })}
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
          onReview={(cart) => { setReviewCart(cart); setScreen('review'); }}
        /></>
      ) : screen === 'receive-list' ? (<><Header title="Receive" subtitle={locName} showBack onBack={() => setScreen('dashboard')} />
        <ReceiveListScreen orders={pendingDeliveries} onOpen={openReceiveCheck} /></>
      ) : screen === 'history' ? (<><Header title="Order History" subtitle={locName} showBack onBack={() => setScreen('dashboard')} /><OrderHistoryScreen orders={orders} filter={historyFilter} onFilterChange={setHistoryFilter} onOpen={openOrderDetail} /></>
      ) : (<><Header title="Purchase" subtitle="Order from your suppliers" rightElement={isManager ? manageIconBtn : undefined} />
        <PurchaseAlerts suppliers={suppliers} />
        <OrdersDashboard cartItemCount={cartTotal.items} pendingDeliveryCount={pendingDeliveries.length} onNavigate={changeTab} locationId={locationId} />
      </>)}
      <Numpad open={numpadOpen} value={numpadValue} onChange={setNumpadValue} label={numpadProduct?.product_name} sublabel={numpadProduct?.product_uom} onConfirm={handleNumpadConfirm} onClose={() => { setNumpadOpen(false); setRecvNumpadLineId(0); setCartNumpadItem(null); }} />
      {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} confirmLabel={confirmDialog.confirmLabel} cancelLabel={confirmDialog.cancelLabel} variant={confirmDialog.variant} onConfirm={confirmDialog.onConfirm} onCancel={confirmDialog.onCancel || (() => setConfirmDialog(null))} />}
    </div>
  );
}
