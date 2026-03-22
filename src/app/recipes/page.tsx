'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RecipeDashboard from '@/components/recipes/RecipeDashboard';
import CookingGuideBrowse from '@/components/recipes/CookingGuideBrowse';
import ProductionGuideBrowse from '@/components/recipes/ProductionGuideBrowse';
import RecipeOverview from '@/components/recipes/RecipeOverview';
import BatchSize from '@/components/recipes/BatchSize';
import IngredientCheck from '@/components/recipes/IngredientCheck';
import CookMode from '@/components/recipes/CookMode';
import CookComplete from '@/components/recipes/CookComplete';
import RecordSelect from '@/components/recipes/RecordSelect';
import CreateDish from '@/components/recipes/CreateDish';
import ActiveRecording, { type RecordedStep } from '@/components/recipes/ActiveRecording';
import RecordingSummary from '@/components/recipes/RecordingSummary';
import EditStep from '@/components/recipes/EditStep';
import ApprovalList from '@/components/recipes/ApprovalList';
import ApprovalReview from '@/components/recipes/ApprovalReview';

interface StepData {
  id: number; sequence: number; step_type: string; instruction: string;
  timer_seconds: number; tip: string; image_count: number;
  ingredients: { id: number; name: string; uom: string }[];
}

interface RecipeCtx {
  mode: 'cooking' | 'production'; recipeId: number; recipeName: string;
  difficulty?: string; categoryName?: string; productQty?: number;
  steps: StepData[]; batch: number; multiplier: number;
}

interface RecordCtx {
  mode: 'cooking' | 'production'; recipeId: number; recipeName: string;
  recordedSteps: RecordedStep[];
}

interface ApprovalCtx {
  versionId: number; recipeName: string;
  productTmplId?: number; bomId?: number; changeSummary: string;
}

type Screen =
  | { type: 'dashboard' } | { type: 'cooking-guide' } | { type: 'production-guide' }
  | { type: 'overview' } | { type: 'batch-size' } | { type: 'ingredient-check' }
  | { type: 'cook-mode' } | { type: 'complete'; elapsed: number }
  | { type: 'record' } | { type: 'create-dish'; createMode: 'cooking' | 'production' }
  | { type: 'active-recording' } | { type: 'recording-summary' }
  | { type: 'edit-step'; stepIndex: number }
  | { type: 'edit' } | { type: 'approvals' } | { type: 'approval-review' } | { type: 'stats' };

export default function RecipesPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [userRole, setUserRole] = useState<string>('staff');
  const [ctx, setCtx] = useState<RecipeCtx>({ mode: 'cooking', recipeId: 0, recipeName: '', steps: [], batch: 1, multiplier: 1 });
  const [recCtx, setRecCtx] = useState<RecordCtx>({ mode: 'cooking', recipeId: 0, recipeName: '', recordedSteps: [] });
  const [aprCtx, setAprCtx] = useState<ApprovalCtx>({ versionId: 0, recipeName: '', changeSummary: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user?.role) setUserRole(d.user.role); }).catch(() => {}); }, []);

  function goHome() { router.push('/'); }
  function goDashboard() { setScreen({ type: 'dashboard' }); }

  if (screen.type === 'dashboard') return <RecipeDashboard userRole={userRole} onNavigate={(id: string) => setScreen({ type: id } as Screen)} onHome={goHome} />;

  if (screen.type === 'cooking-guide') return (
    <CookingGuideBrowse userRole={userRole}
      onSelectRecipe={(r) => { const c = r.x_recipe_category_id; setCtx({ mode: 'cooking', recipeId: r.id, recipeName: r.name, difficulty: r.x_recipe_difficulty || undefined, categoryName: c ? c[1] : undefined, steps: [], batch: 1, multiplier: 1 }); setScreen({ type: 'overview' }); }}
      onBack={goDashboard} onHome={goHome} />
  );

  if (screen.type === 'production-guide') return (
    <ProductionGuideBrowse userRole={userRole}
      onSelectRecipe={(r) => { const nm = r.product_tmpl_id ? r.product_tmpl_id[1] : `BoM #${r.id}`; const c = r.x_recipe_category_id; setCtx({ mode: 'production', recipeId: r.id, recipeName: nm, difficulty: r.x_recipe_difficulty || undefined, categoryName: c ? c[1] : undefined, productQty: r.product_qty, steps: [], batch: 10, multiplier: 1 }); setScreen({ type: 'overview' }); }}
      onBack={goDashboard} onHome={goHome} />
  );

  if (screen.type === 'overview') return (
    <RecipeOverview mode={ctx.mode} recipeId={ctx.recipeId} recipeName={ctx.recipeName} difficulty={ctx.difficulty} categoryName={ctx.categoryName} productQty={ctx.productQty}
      onBack={() => setScreen({ type: ctx.mode === 'cooking' ? 'cooking-guide' : 'production-guide' })} onHome={goHome}
      onStartCooking={(steps) => { setCtx(p => ({ ...p, steps })); setScreen({ type: 'batch-size' }); }} />
  );

  if (screen.type === 'batch-size') return (
    <BatchSize mode={ctx.mode} recipeName={ctx.recipeName} baseBatch={ctx.mode === 'cooking' ? 1 : (ctx.productQty || 10)}
      onBack={() => setScreen({ type: 'overview' })} onHome={goHome}
      onConfirm={(b, m) => { setCtx(p => ({ ...p, batch: b, multiplier: m })); setScreen({ type: 'ingredient-check' }); }} />
  );

  if (screen.type === 'ingredient-check') return (
    <IngredientCheck mode={ctx.mode} recipeName={ctx.recipeName} steps={ctx.steps} multiplier={ctx.multiplier}
      onBack={() => setScreen({ type: 'batch-size' })} onHome={goHome}
      onStartCook={() => setScreen({ type: 'cook-mode' })} />
  );

  if (screen.type === 'cook-mode') return (
    <CookMode mode={ctx.mode} recipeName={ctx.recipeName} steps={ctx.steps} batch={ctx.batch} multiplier={ctx.multiplier}
      onExit={goDashboard} onComplete={(e) => setScreen({ type: 'complete', elapsed: e })} />
  );

  if (screen.type === 'complete') return (
    <CookComplete mode={ctx.mode} recipeName={ctx.recipeName} stepCount={ctx.steps.length} elapsedSeconds={screen.elapsed} batch={ctx.batch}
      onDashboard={goDashboard} onCookAnother={() => setScreen({ type: ctx.mode === 'cooking' ? 'cooking-guide' : 'production-guide' })} />
  );

  if (screen.type === 'record') return (
    <RecordSelect userRole={userRole}
      onSelectRecipe={(r, m) => { setRecCtx({ mode: m, recipeId: r.id, recipeName: r.name, recordedSteps: [] }); setScreen({ type: 'active-recording' }); }}
      onCreateNew={(m) => setScreen({ type: 'create-dish', createMode: m })}
      onBack={goDashboard} onHome={goHome} />
  );

  if (screen.type === 'create-dish') return (
    <CreateDish mode={screen.createMode}
      onBack={() => setScreen({ type: 'record' })} onHome={goHome}
      onCreated={(d) => { setRecCtx({ mode: d.mode === 'cooking_guide' ? 'cooking' : 'production', recipeId: 0, recipeName: d.name, recordedSteps: [] }); setScreen({ type: 'active-recording' }); }} />
  );

  if (screen.type === 'active-recording') return (
    <ActiveRecording recipeName={recCtx.recipeName} mode={recCtx.mode}
      onFinish={(s) => { setRecCtx(p => ({ ...p, recordedSteps: s })); setScreen({ type: 'recording-summary' }); }}
      onBack={() => setScreen({ type: 'record' })} />
  );

  if (screen.type === 'recording-summary') return (
    <RecordingSummary recipeName={recCtx.recipeName} recipeId={recCtx.recipeId} mode={recCtx.mode}
      steps={recCtx.recordedSteps}
      onEditStep={(i) => setScreen({ type: 'edit-step', stepIndex: i })}
      onDeleteStep={(i) => setRecCtx(p => ({ ...p, recordedSteps: p.recordedSteps.filter((_, idx) => idx !== i) }))}
      onAddStep={() => setScreen({ type: 'active-recording' })}
      submitting={submitting}
      onSubmit={async () => {
        setSubmitting(true);
        try {
          const body: Record<string, unknown> = {
            steps: recCtx.recordedSteps.map(s => ({ step_type: s.step_type, instruction: s.instruction, timer_seconds: s.timer_seconds, tip: s.tip, images: s.photos.map(p => ({ data: p.split(',')[1] || p, source: 'record' })) })),
            change_summary: 'New recipe recording from portal',
          };
          if (recCtx.recipeId > 0) { if (recCtx.mode === 'cooking') body.product_tmpl_id = recCtx.recipeId; else body.bom_id = recCtx.recipeId; }
          const res = await fetch('/api/recipes/steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (res.ok) { alert('Recipe submitted for review!'); goDashboard(); }
          else { const err = await res.json(); alert(`Error: ${err.error || 'Failed'}`); }
        } catch (_e) { alert('Failed to submit. Check connection.'); }
        finally { setSubmitting(false); }
      }}
      onBack={() => setScreen({ type: 'active-recording' })} onHome={goHome} />
  );

  if (screen.type === 'edit-step') {
    const step = recCtx.recordedSteps[screen.stepIndex];
    if (!step) { setScreen({ type: 'recording-summary' }); return null; }
    return <EditStep step={step} stepIndex={screen.stepIndex}
      onSave={(u) => { setRecCtx(p => ({ ...p, recordedSteps: p.recordedSteps.map((s, i) => i === screen.stepIndex ? u : s) })); setScreen({ type: 'recording-summary' }); }}
      onBack={() => setScreen({ type: 'recording-summary' })} />;
  }

  if (screen.type === 'approvals') return (
    <ApprovalList userRole={userRole}
      onReview={(v) => {
        const nm = v.product_tmpl_id ? v.product_tmpl_id[1] : v.bom_id ? v.bom_id[1] : 'Unknown';
        setAprCtx({ versionId: v.id, recipeName: nm, productTmplId: v.product_tmpl_id ? v.product_tmpl_id[0] : undefined, bomId: v.bom_id ? v.bom_id[0] : undefined, changeSummary: v.change_summary || '' });
        setScreen({ type: 'approval-review' });
      }}
      onBack={goDashboard} onHome={goHome} />
  );

  if (screen.type === 'approval-review') return (
    <ApprovalReview versionId={aprCtx.versionId} recipeName={aprCtx.recipeName}
      productTmplId={aprCtx.productTmplId} bomId={aprCtx.bomId} changeSummary={aprCtx.changeSummary} approving={submitting}
      onApprove={async () => {
        setSubmitting(true);
        try {
          const res = await fetch('/api/recipes/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_id: aprCtx.versionId, action: 'approve' }) });
          if (res.ok) { alert('Recipe approved!'); setScreen({ type: 'approvals' }); }
          else { const err = await res.json(); alert(`Error: ${err.error}`); }
        } catch (_e) { alert('Failed to approve.'); }
        finally { setSubmitting(false); }
      }}
      onReject={async (reason) => {
        setSubmitting(true);
        try {
          const res = await fetch('/api/recipes/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_id: aprCtx.versionId, action: 'reject', reason }) });
          if (res.ok) { alert('Recipe rejected.'); setScreen({ type: 'approvals' }); }
          else { const err = await res.json(); alert(`Error: ${err.error}`); }
        } catch (_e) { alert('Failed to reject.'); }
        finally { setSubmitting(false); }
      }}
      onBack={() => setScreen({ type: 'approvals' })} />
  );

  // Placeholder (edit, stats)
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={goDashboard} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white capitalize">{screen.type.replace(/-/g, ' ')}</h1>
            <p className="text-[12px] text-white/50 mt-0.5">Recipe Guide</p>
          </div>
          <button onClick={goHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center">
          <div className="text-5xl mb-4">{'\ud83d\udee0\ufe0f'}</div>
          <h2 className="text-lg font-bold text-gray-800 mb-2 capitalize">{screen.type.replace(/-/g, ' ')}</h2>
          <p className="text-sm text-gray-500 mb-6">Coming soon</p>
          <button onClick={goDashboard} className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl active:bg-green-700">Back to Recipe Guide</button>
        </div>
      </div>
    </div>
  );
}
