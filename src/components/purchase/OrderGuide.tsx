import React from 'react';
import SearchInput from './SearchInput';
import { GuideItem, Supplier } from './types';

interface OrderGuideProps {
  guideItems: GuideItem[];
  guideSearch: string;
  setGuideSearch: (v: string) => void;
  guideCategory: string;
  setGuideCategory: (v: string) => void;
  quantities: Record<number, number>;
  updateCartQty: (product: GuideItem, qty: number) => void;
  openNumpad: (product: GuideItem) => void;
  suppliers: Supplier[];
  guideSupplierId: number;
  locName: string;
  changeTab: (t: 'order' | 'cart' | 'receive' | 'history') => void;
}

export default function OrderGuide({
  guideItems, guideSearch, setGuideSearch, guideCategory, setGuideCategory,
  quantities, updateCartQty, openNumpad, suppliers, guideSupplierId, locName, changeTab,
}: OrderGuideProps) {
  const allCategories = ['All', ...Array.from(new Set(guideItems.map(i => i.category_name || 'Other')))];
  const filtered = guideItems.filter(i => {
    if (guideSearch && !i.product_name.toLowerCase().includes(guideSearch.toLowerCase())) return false;
    if (guideCategory !== 'All' && (i.category_name || 'Other') !== guideCategory) return false;
    return true;
  });
  const categories = Array.from(new Set(filtered.map(i => i.category_name || 'Other')));
  const cartItemCount = Object.values(quantities).filter(q => q > 0).length;
  const cartAmount = guideItems.reduce((sum, i) => sum + (quantities[i.product_id] || 0) * i.price, 0);

  return (<>
    <div className="px-4 py-3 pb-44">
      {(() => {
        const supplier = suppliers.find(s => s.id === guideSupplierId);
        const days = (() => { try { return JSON.parse(supplier?.order_days || '[]'); } catch { return []; } })();
        if (days.length === 0) return null;
        const dayStr = days.map((d: string) => d.charAt(0).toUpperCase() + d.slice(1)).join(' & ');
        return <div className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-blue-50 border border-blue-200 mb-3 text-[var(--fs-sm)] text-blue-800"><span className="text-[14px] mt-0.5">&#128197;</span><span>Order days: <strong>{dayStr}</strong></span></div>;
      })()}
      <SearchInput value={guideSearch} onChange={setGuideSearch} placeholder="Search products..." />
      <div className="flex gap-1.5 overflow-x-auto pb-3 -mx-1 px-1">
        {allCategories.map(cat => (
          <button key={cat} onClick={() => setGuideCategory(cat)} className={`px-4 py-2.5 rounded-full text-[var(--fs-xs)] font-semibold whitespace-nowrap flex-shrink-0 ${guideCategory === cat ? 'bg-green-600 text-white' : 'bg-white text-gray-500 border border-gray-200'}`}>{cat}</button>
        ))}
      </div>
      {filtered.length === 0 && <div className="text-center py-12"><div className="text-[var(--fs-lg)] font-semibold text-gray-900 mb-1">No products found</div></div>}
      {categories.map(cat => (
        <div key={cat}>
          <div className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 pt-3 pb-2 flex justify-between"><span>{cat}</span><span className="font-mono text-gray-300">{filtered.filter(i => (i.category_name || 'Other') === cat).length}</span></div>
          <div className="bg-white border border-gray-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-3.5">
            {filtered.filter(i => (i.category_name || 'Other') === cat).map(item => {
              const qty = quantities[item.product_id] || 0;
              return (
                <div key={item.id} className={`flex items-center gap-2.5 py-2.5 border-b border-gray-100 last:border-0 ${qty > 0 ? 'bg-green-50 -mx-3.5 px-3.5 rounded-lg mb-1' : ''}`}>
                  <div className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center text-[var(--fs-lg)] flex-shrink-0">&#128230;</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--fs-xs)] text-gray-400 font-semibold uppercase tracking-wide">{item.product_uom}</div>
                    <div className="text-[var(--fs-base)] font-semibold text-gray-900 truncate">{item.product_name}</div>
                    <div className="text-[var(--fs-sm)] text-gray-500 font-mono">&euro;{item.price.toFixed(2)}/{item.product_uom}</div>
                  </div>
                  {qty > 0 ? (
                    <div className="flex items-center flex-shrink-0">
                      <button onClick={() => updateCartQty(item, Math.max(0, qty - 1))} className="w-11 h-11 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[var(--fs-xl)] text-gray-600 active:bg-gray-100">-</button>
                      <button onClick={() => openNumpad(item)} className="w-11 h-11 flex items-center justify-center text-[var(--fs-lg)] font-bold font-mono text-gray-900">{qty}</button>
                      <button onClick={() => updateCartQty(item, qty + 1)} className="w-11 h-11 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-[var(--fs-xl)] text-gray-600 active:bg-gray-100">+</button>
                    </div>
                  ) : (
                    <button onClick={() => updateCartQty(item, 1)} className="w-11 h-11 rounded-lg bg-green-600 flex items-center justify-center text-white text-[var(--fs-xl)] font-bold shadow-sm active:bg-green-700 flex-shrink-0">+</button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
    {cartItemCount > 0 && (
      <div className="fixed bottom-16 left-0 right-0 max-w-lg mx-auto bg-white border-t border-gray-200 px-4 py-3 z-50">
        <div className="flex justify-between items-center mb-2">
          <div>
            <div className="text-[18px] font-extrabold font-mono text-gray-900">&euro;{cartAmount.toFixed(2)}</div>
            <div className="text-[var(--fs-xs)] text-gray-500">{cartItemCount} items &bull; shared cart ({locName})</div>
          </div>
        </div>
        <button onClick={() => changeTab('cart')} className="w-full py-3.5 rounded-xl bg-green-600 text-white text-[14px] font-bold shadow-lg shadow-green-600/30 active:bg-green-700 active:scale-[0.975] transition-all">View cart &rarr;</button>
      </div>
    )}
  </>);
}
