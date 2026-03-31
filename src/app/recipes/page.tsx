'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { setDebugInfo } from '@/components/ui/DebugOverlay';
import { type CookingSession, type StepData, createSessionId } from '@/lib/cooking-sessions';
import { unlockAudio } from '@/lib/timer-sounds';
import { loadSettings, type NotificationSettings } from '@/lib/notification-settings';
import TimerAlert, { type TimerAlertItem } from '@/components/ui/TimerAlert';
import SettingsPage from '@/components/recipes/Settings';
import RecipeDashboard from '@/components/recipes/RecipeDashboard';
import CookingGuideBrowse from '@/components/recipes/CookingGuideBrowse';
import { trackRecipeOpen } from '@/components/recipes/CookingGuideBrowse';
import ProductionGuideBrowse from '@/components/recipes/ProductionGuideBrowse';
import RecipeOverview from '@/components/recipes/RecipeOverview';
import BatchSize from '@/components/recipes/BatchSize';
import IngredientCheck from '@/components/recipes/IngredientCheck';
import CookMode from '@/components/recipes/CookMode';
import CookComplete from '@/components/recipes/CookComplete';
import ActiveSessions from '@/components/recipes/ActiveSessions';
import RecordSelect from '@/components/recipes/RecordSelect';
import CreateDish from '@/components/recipes/CreateDish';
import { useTopBar } from '@/components/ui/TopBarContext';
import ActiveRecording, { type RecordedStep, type RecordedIngredient } from '@/components/recipes/ActiveRecording';
import RecordingSummary from '@/components/recipes/RecordingSummary';
import EditStep from '@/components/recipes/EditStep';
import ApprovalList from '@/components/recipes/ApprovalList';
import ApprovalReview from '@/components/recipes/ApprovalReview';
import EditRecipeBrowse from '@/components/recipes/EditRecipeBrowse';
import EditRecipeOverview from '@/components/recipes/EditRecipeOverview';
import EditMetadata from '@/components/recipes/EditMetadata';
import Toast from '@/components/ui/Toast';

interface RecipeCtx {
  mode: 'cooking' | 'production'; recipeId: number; recipeName: string;
  difficulty?: string; categoryName?: string; productQty?: number;
  steps: StepData[]; batch: number; multiplier: number;
}
interface RecordCtx { mode: 'cooking' | 'production'; recipeId: number; recipeName: string; recordedSteps: RecordedStep[]; ingredients: RecordedIngredient[]; }
interface ApprovalCtx { versionId: number; recipeName: string; productTmplId?: number; bomId?: number; changeSummary: string; }
interface EditCtx {
  mode: 'cooking' | 'production'; recipeId: number; recipeName: string;
  difficulty: string; categoryId: number | null; categoryName: string;
  productQty: number; steps: RecordedStep[]; isPublished: boolean;
}

const DBG: Record<string, [string, string]> = {
  'dashboard': ['S0: Recipe Dashboard', 'RecipeDashboard'],
  'cooking-guide': ['S1: Cooking Guide Browse', 'CookingGuideBrowse'],
  'production-guide': ['S1B: Production Guide Browse', 'ProductionGuideBrowse'],
  'overview': ['S2: Recipe Overview', 'RecipeOverview'],
  'batch-size': ['S3: Batch Size', 'BatchSize'],
  'ingredient-check': ['S4: Ingredient Check', 'IngredientCheck'],
  'cook-mode': ['S5: Cook Mode', 'CookMode'],
  'active-sessions': ['Cooking Board', 'ActiveSessions'],
  'complete': ['S7: Complete', 'CookComplete'],
  'record': ['S10: Record Select', 'RecordSelect'],
  'create-dish': ['S10C: Create New Dish', 'CreateDish'],
  'active-recording': ['S11: Active Recording', 'ActiveRecording'],
  'recording-summary': ['S12: Recording Summary', 'RecordingSummary'],
  'edit-step': ['S13: Edit Step', 'EditStep'],
  'approvals': ['S9: Approvals List', 'ApprovalList'],
  'approval-review': ['S14: Approval Review', 'ApprovalReview'],
  'edit-browse': ['E1: Edit Browse', 'EditRecipeBrowse'],
  'edit-overview': ['E2: Edit Overview', 'EditRecipeOverview'],
  'edit-metadata': ['E3: Edit Metadata', 'EditMetadata'],
  'edit-steps': ['E4: Edit Steps', 'RecordingSummary'],
  'edit-step-detail': ['E5: Edit Step Detail', 'EditStep'],
};

type Screen =
  | { type: 'dashboard' } | { type: 'cooking-guide' } | { type: 'production-guide' }
  | { type: 'overview' } | { type: 'batch-size' } | { type: 'ingredient-check' }
  | { type: 'cook-mode'; sessionId: string }
  | { type: 'active-sessions' }
  | { type: 'complete'; recipeName: string; mode: 'cooking' | 'production'; stepCount: number; elapsed: number; batch: number }
  | { type: 'record' } | { type: 'create-dish'; createMode: 'cooking' | 'production' }
  | { type: 'active-recording' } | { type: 'recording-summary' }
  | { type: 'edit-step'; stepIndex: number }
  | { type: 'approvals' } | { type: 'approval-review' }
  | { type: 'edit-browse' } | { type: 'edit-overview' } | { type: 'edit-metadata' }
  | { type: 'edit-steps' } | { type: 'edit-step-detail'; stepIndex: number }
  | { type: 'stats' }
  | { type: 'settings' };

export default function RecipesPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>(() => {
    if (typeof window === 'undefined') return { type: 'dashboard' };
    try {
      const saved = localStorage.getItem('kw_cook_sessions');
      if (saved) {
        const parsed = JSON.parse(saved) as CookingSession[];
        if (parsed.some(s => s.status === 'active')) return { type: 'active-sessions' };
      }
    } catch (_e) { /* */ }
    return { type: 'dashboard' };
  });
  const [userRole, setUserRole] = useState<string>('staff');
  const [ctx, setCtx] = useState<RecipeCtx>({ mode: 'cooking', recipeId: 0, recipeName: '', steps: [], batch: 1, multiplier: 1 });
  const [recCtx, setRecCtx] = useState<RecordCtx>({ mode: 'cooking', recipeId: 0, recipeName: '', recordedSteps: [], ingredients: [] });
  const [aprCtx, setAprCtx] = useState<ApprovalCtx>({ versionId: 0, recipeName: '', changeSummary: '' });
  const [editCtx, setEditCtx] = useState<EditCtx>({ mode: 'cooking', recipeId: 0, recipeName: '', difficulty: '', categoryId: null, categoryName: '', productQty: 0, steps: [], isPublished: true });
  const [submitting, setSubmitting] = useState(false);
  const [sessions, setSessions] = useState<CookingSession[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('kw_cook_sessions');
      if (saved) {
        const parsed = JSON.parse(saved) as CookingSession[];
        return parsed.filter(s => s.status === 'active');
      }
    } catch (_e) { /* */ }
    return [];
  });
  const [timerAlerts, setTimerAlerts] = useState<TimerAlertItem[]>([]);
  const alertedRef = useRef<Set<string>>(new Set());
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>(() => loadSettings());
  const [browseMode, setBrowseMode] = useState<'cooking' | 'production'>('cooking');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  function showToast(msg: string, type: 'success' | 'error' | 'info' = 'info') { setToast({ msg, type }); }

  // Persist sessions to localStorage on every change
  useEffect(() => {
    try { localStorage.setItem('kw_cook_sessions', JSON.stringify(sessions)); } catch (_e) { /* */ }
  }, [sessions]);

  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.user?.role) setUserRole(d.user.role); }).catch(() => {}); }, []);

  // Reset to dashboard when entering from another module
  useEffect(() => {
    const reset = sessionStorage.getItem('kw_recipes_reset');
    if (reset) {
      sessionStorage.removeItem('kw_recipes_reset');

      setScreen({ type: 'dashboard' });
    }
  });

  // Unlock Web Audio on first user interaction (required by iOS/Android)
  useEffect(() => {
    const handler = () => { unlockAudio(); document.removeEventListener('touchstart', handler); document.removeEventListener('click', handler); };
    document.addEventListener('touchstart', handler, { once: true });
    document.addEventListener('click', handler, { once: true });
    return () => { document.removeEventListener('touchstart', handler); document.removeEventListener('click', handler); };
  }, []);

  // Global timer alert — fires on ANY screen when a session timer completes
  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      for (const s of sessions) {
        if (s.status !== 'active' || !s.timerEndAt) continue;
        const key = `${s.id}:${s.currentStep}`;
        if (s.timerEndAt <= now && !alertedRef.current.has(key)) {
          alertedRef.current.add(key);
          const step = s.steps[s.currentStep];
          const stepLabel = step
            ? `Step ${s.currentStep + 1}/${s.steps.length} \u00b7 ${(step.step_type || '').toUpperCase()}`
            : `Step ${s.currentStep + 1}`;
          setTimerAlerts(prev => {
            if (prev.some(a => a.sessionId === s.id)) return prev;
            return [...prev, { sessionId: s.id, recipeName: s.recipeName, stepLabel, firedAt: now }];
          });
        }
      }
    }, 500);
    return () => clearInterval(iv);
  }, [sessions]);

  function dismissAlert(sessionId: string) {
    setTimerAlerts(prev => prev.filter(a => a.sessionId !== sessionId));
  }

  // Hide top bar in immersive recipe screens (cooking/production guides, cook mode, etc.)
  const { setHidden: setTopBarHidden } = useTopBar();
  useEffect(() => {
    const showTopBar = screen.type === 'dashboard' || screen.type === 'settings' || screen.type === 'stats' || screen.type === 'approvals';
    setTopBarHidden(!showTopBar);
    return () => setTopBarHidden(false);
  }, [screen.type, setTopBarHidden]);

  useEffect(() => {
    const d = DBG[screen.type];
    setDebugInfo({ module: 'Chef Guide', screen: d ? d[0] : screen.type, component: d ? d[1] : screen.type, mode: ctx.mode, recipeId: ctx.recipeId || recCtx.recipeId || editCtx.recipeId || undefined, recipeName: ctx.recipeName || recCtx.recipeName || editCtx.recipeName || undefined, batch: ctx.batch, stepCount: ctx.steps.length || recCtx.recordedSteps.length || editCtx.steps.length || undefined });
  }, [screen, ctx, recCtx, editCtx]);

  function goHome() { router.push('/'); }
  function goDashboard() { setScreen({ type: 'dashboard' }); }
  function goCookingBoard() { setScreen({ type: 'active-sessions' }); }
  function goBackSmart() { if (activeSessions.length > 0) goCookingBoard(); else goDashboard(); }

  const updateSession = useCallback((id: string, updates: Partial<CookingSession>) => {
    setSessions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);
  function removeSession(id: string) { setSessions(prev => prev.filter(s => s.id !== id)); }
  function createCookingSession(): string {
    const id = createSessionId();
    setSessions(prev => [...prev, {
      id, recipeId: ctx.recipeId, recipeName: ctx.recipeName, mode: ctx.mode, steps: ctx.steps,
      currentStep: 0, batch: ctx.batch, multiplier: ctx.multiplier,
      timerEndAt: null, timerTotal: 0, timerPausedLeft: null,
      showPlating: false, status: 'active', startedAt: Date.now(),
    }]);
    return id;
  }

  const activeSessions = sessions.filter(s => s.status === 'active');

  // Alert banner — renders on top of everything, on ANY screen
  const alertEl = (
    <TimerAlert
      alerts={timerAlerts}
      settings={notifSettings}
      onTap={(sid) => { dismissAlert(sid); setScreen({ type: 'cook-mode', sessionId: sid }); }}
      onDismiss={dismissAlert}
    />
  );

  // ===== COOK FLOW =====
  if (screen.type === 'dashboard') return (<>{alertEl}<RecipeDashboard userRole={userRole}
    onNavigate={(id: string) => {
      if (id === 'cooking-guide') { setBrowseMode('cooking'); goCookingBoard(); return; }
      if (id === 'production-guide') { setBrowseMode('production'); goCookingBoard(); return; }
      if (id === 'edit') { setScreen({ type: 'edit-browse' }); return; }
      setScreen({ type: id } as Screen);
    }}
    onSettings={() => setScreen({ type: 'settings' }) } onHome={goHome} /></>);

  if (screen.type === 'active-sessions') return (<>{alertEl}<ActiveSessions sessions={sessions}
    onSelectSession={(id) => setScreen({ type: 'cook-mode', sessionId: id })}
    onNewDish={() => setScreen({ type: browseMode === 'cooking' ? 'cooking-guide' : 'production-guide' })} onBack={goDashboard} onEndSession={removeSession} /></>);

  if (screen.type === 'cooking-guide') return (<>{alertEl}<CookingGuideBrowse userRole={userRole}
    onSelectRecipe={(r) => { trackRecipeOpen(r.id); const c = r.x_recipe_category_id; setCtx({ mode: 'cooking', recipeId: r.id, recipeName: r.name, difficulty: r.x_recipe_difficulty || undefined, categoryName: c ? c[1] : undefined, steps: [], batch: 1, multiplier: 1 }); setScreen({ type: 'overview' }); }}
    onBack={() => activeSessions.length > 0 ? goCookingBoard() : goDashboard()} onHome={goHome} /></>);

  if (screen.type === 'production-guide') return (<>{alertEl}<ProductionGuideBrowse userRole={userRole}
    onSelectRecipe={(r) => { const nm = r.product_tmpl_id ? r.product_tmpl_id[1] : `BoM #${r.id}`; const c = r.x_recipe_category_id; setCtx({ mode: 'production', recipeId: r.id, recipeName: nm, difficulty: r.x_recipe_difficulty || undefined, categoryName: c ? c[1] : undefined, productQty: r.product_qty, steps: [], batch: 10, multiplier: 1 }); setScreen({ type: 'overview' }); }}
    onBack={() => activeSessions.length > 0 ? goCookingBoard() : goDashboard()} onHome={goHome} /></>);

  if (screen.type === 'overview') return (<>{alertEl}<RecipeOverview mode={ctx.mode} recipeId={ctx.recipeId} recipeName={ctx.recipeName} difficulty={ctx.difficulty} categoryName={ctx.categoryName} productQty={ctx.productQty}
    userRole={userRole}
    onEdit={() => {
      setEditCtx({ mode: ctx.mode, recipeId: ctx.recipeId, recipeName: ctx.recipeName, difficulty: ctx.difficulty || '', categoryId: null, categoryName: ctx.categoryName || '', productQty: ctx.productQty || 0, steps: [], isPublished: true });
      setScreen({ type: 'edit-overview' });
    }}
    onBack={() => setScreen({ type: ctx.mode === 'cooking' ? 'cooking-guide' : 'production-guide' })}
    onStartCooking={(steps) => { setCtx(p => ({ ...p, steps })); setScreen({ type: 'batch-size' }); }} /></>);

  if (screen.type === 'batch-size') return (<>{alertEl}<BatchSize mode={ctx.mode} recipeName={ctx.recipeName} baseBatch={ctx.mode === 'cooking' ? 1 : (ctx.productQty || 10)}
    onBack={() => setScreen({ type: 'overview' })}
    onConfirm={(b, m) => { setCtx(p => ({ ...p, batch: b, multiplier: m })); setScreen({ type: 'ingredient-check' }); }} /></>);

  if (screen.type === 'ingredient-check') return (<>{alertEl}<IngredientCheck mode={ctx.mode} recipeName={ctx.recipeName} steps={ctx.steps} multiplier={ctx.multiplier}
    onBack={() => setScreen({ type: 'batch-size' })}
    onStartCook={() => { const sid = createCookingSession(); setScreen({ type: 'cook-mode', sessionId: sid }); }} /></>);

  if (screen.type === 'cook-mode') {
    const session = sessions.find(s => s.id === screen.sessionId);
    if (!session) { if (activeSessions.length > 0) goCookingBoard(); else goDashboard(); return null; }
    return (<>{alertEl}<CookMode session={session} sessionCount={activeSessions.length}
      onUpdateSession={updateSession}
      onDashboard={goCookingBoard}
      onEndSession={(sid) => { removeSession(sid); goBackSmart(); }}
      onComplete={(sid, elapsed) => {
        const s = sessions.find(x => x.id === sid);
        removeSession(sid);
        setScreen({ type: 'complete', recipeName: s?.recipeName || '', mode: s?.mode || 'cooking', stepCount: s?.steps.length || 0, elapsed, batch: s?.batch || 1 });
      }} /></>);
  }

  if (screen.type === 'complete') return (<>{alertEl}<CookComplete mode={screen.mode} recipeName={screen.recipeName} stepCount={screen.stepCount} elapsedSeconds={screen.elapsed} batch={screen.batch}
    onDashboard={() => activeSessions.length > 0 ? goCookingBoard() : goDashboard()}
    onCookAnother={() => activeSessions.length > 0 ? goCookingBoard() : setScreen({ type: screen.mode === 'cooking' ? 'cooking-guide' : 'production-guide' })} /></>);

  // ===== RECORD FLOW =====
  if (screen.type === 'record') return (<RecordSelect userRole={userRole}
    onSelectRecipe={(r, m) => { setRecCtx({ mode: m, recipeId: r.id, recipeName: r.name, recordedSteps: [], ingredients: [] }); setScreen({ type: 'active-recording' }); }}
    onCreateNew={(m) => setScreen({ type: 'create-dish', createMode: m })} onBack={goDashboard} />);

  if (screen.type === 'create-dish') return (<CreateDish mode={screen.createMode}
    onBack={() => setScreen({ type: 'record' })}
    onCreated={(d) => { setRecCtx({ mode: d.mode === 'cooking_guide' ? 'cooking' : 'production', recipeId: d.odooId, recipeName: d.name, recordedSteps: [], ingredients: [] }); setScreen({ type: 'active-recording' }); }} />);

  if (screen.type === 'active-recording') return (<>{alertEl}<ActiveRecording recipeName={recCtx.recipeName} mode={recCtx.mode} initialSteps={recCtx.recordedSteps}
    ingredients={recCtx.ingredients}
    onIngredientsChange={(ings) => setRecCtx(p => ({ ...p, ingredients: ings }))}
    onFinish={(s) => { setRecCtx(p => ({ ...p, recordedSteps: s })); setScreen({ type: 'recording-summary' }); }} onBack={() => setScreen({ type: 'record' })} /></>);

  if (screen.type === 'recording-summary') {
    const canSaveDirect = userRole === 'admin' || userRole === 'manager';
    return (
    <RecordingSummary recipeName={recCtx.recipeName} recipeId={recCtx.recipeId} mode={recCtx.mode} steps={recCtx.recordedSteps}
      ingredients={recCtx.ingredients} userRole={userRole}
      onEditStep={(i) => setScreen({ type: 'edit-step', stepIndex: i })}
      onDeleteStep={(i) => setRecCtx(p => ({ ...p, recordedSteps: p.recordedSteps.filter((_, idx) => idx !== i) }))}
      onAddStep={() => { const b: RecordedStep = { id: `step_${Date.now()}`, step_type: 'prep', instruction: '', timer_seconds: 0, tip: '', photos: [], ingredientIds: [] }; const n = recCtx.recordedSteps.length; setRecCtx(p => ({ ...p, recordedSteps: [...p.recordedSteps, b] })); setScreen({ type: 'edit-step', stepIndex: n }); }}
      onReorder={(reordered) => setRecCtx(p => ({ ...p, recordedSteps: reordered }))}
      submitting={submitting}
      toastMessage={toast?.msg} toastType={toast?.type} onDismissToast={() => setToast(null)}
      onSubmit={async () => {
        if (recCtx.recipeId <= 0) {
          showToast('This dish needs to be linked to Odoo before saving steps. Please select an existing recipe or ask an admin to create it in Odoo.', 'error');
          return;
        }
        if (recCtx.recordedSteps.length === 0) { showToast('Add at least one step before saving.', 'error'); return; }
        const empty = recCtx.recordedSteps.filter(s => !s.instruction.trim());
        if (empty.length > 0) { showToast(`${empty.length} step(s) have no instructions. Edit them first.`, 'error'); return; }
        setSubmitting(true);
        try {
          const body: Record<string, unknown> = {
            steps: recCtx.recordedSteps.map(s => ({
              step_type: s.step_type, instruction: s.instruction, timer_seconds: s.timer_seconds, tip: s.tip,
              images: s.photos.map(p => ({ data: p.split(',')[1] || p, source: 'record' })),
              ingredients: (s.ingredientIds || []).map(iid => {
                const ing = recCtx.ingredients.find(i => i.id === iid);
                if (!ing) return null;
                return { product_id: ing.productId, qty: ing.qty, uom_id: ing.uomId || false };
              }).filter(Boolean),
            })),
            change_summary: 'New recipe recording',
            auto_publish: canSaveDirect,
          };
          if (recCtx.mode === 'cooking') body.product_tmpl_id = recCtx.recipeId; else body.bom_id = recCtx.recipeId;
          const res = await fetch('/api/recipes/steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (res.ok) {
            showToast(canSaveDirect ? 'Recipe saved and published!' : 'Submitted for review!', 'success');
            setTimeout(goDashboard, 1500);
          } else {
            const e = await res.json();
            showToast(`Could not save: ${e.error || 'Unknown error'}`, 'error');
          }
        } catch (_e) { showToast('Connection failed. Please try again.', 'error'); } finally { setSubmitting(false); }
      }}
      onBack={() => setScreen({ type: 'active-recording' })} />
    );
  }

  if (screen.type === 'edit-step') {
    const step = recCtx.recordedSteps[screen.stepIndex];
    if (!step) { setScreen({ type: 'recording-summary' }); return null; }
    return <>{alertEl}<EditStep step={step} stepIndex={screen.stepIndex}
      ingredients={recCtx.ingredients}
      onSave={(u) => { if (!u.instruction.trim()) setRecCtx(p => ({ ...p, recordedSteps: p.recordedSteps.filter((_, i) => i !== screen.stepIndex) })); else setRecCtx(p => ({ ...p, recordedSteps: p.recordedSteps.map((s, i) => i === screen.stepIndex ? u : s) })); setScreen({ type: 'recording-summary' }); }}
      onBack={() => { if (!step.instruction.trim()) setRecCtx(p => ({ ...p, recordedSteps: p.recordedSteps.filter((_, i) => i !== screen.stepIndex) })); setScreen({ type: 'recording-summary' }); }}
      /></>;
  }

  // ===== APPROVALS =====
  if (screen.type === 'approvals') return (<ApprovalList userRole={userRole}
    onReview={(v) => { setAprCtx({ versionId: v.id, recipeName: v.recipe_name, productTmplId: v.product_tmpl_id || undefined, bomId: v.bom_id || undefined, changeSummary: v.change_summary || '' }); setScreen({ type: 'approval-review' }); }}
    onBack={goDashboard} />);

  if (screen.type === 'approval-review') return (<ApprovalReview versionId={aprCtx.versionId} recipeName={aprCtx.recipeName}
    productTmplId={aprCtx.productTmplId} bomId={aprCtx.bomId} changeSummary={aprCtx.changeSummary} approving={submitting}
    onApprove={async () => { setSubmitting(true); try { const r = await fetch('/api/recipes/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_id: aprCtx.versionId, action: 'approve' }) }); if (r.ok) { showToast('Recipe approved and published!', 'success'); setTimeout(() => setScreen({ type: 'approvals' }), 1500); } else { const e = await r.json(); showToast(`Approval failed: ${e.error}`, 'error'); } } catch (_e) { showToast('Connection failed.', 'error'); } finally { setSubmitting(false); } }}
    onReject={async (reason) => { setSubmitting(true); try { const r = await fetch('/api/recipes/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version_id: aprCtx.versionId, action: 'reject', reason }) }); if (r.ok) { showToast('Recipe rejected. Submitter will be notified.', 'success'); setTimeout(() => setScreen({ type: 'approvals' }), 1500); } else { const e = await r.json(); showToast(`Rejection failed: ${e.error}`, 'error'); } } catch (_e) { showToast('Connection failed.', 'error'); } finally { setSubmitting(false); } }}
    onBack={() => setScreen({ type: 'approvals' })} />);

  // ===== EDIT FLOW =====
  if (screen.type === 'edit-browse') return (<>{alertEl}<EditRecipeBrowse userRole={userRole}
    onSelectRecipe={(r) => {
      setEditCtx({ mode: r.mode, recipeId: r.id, recipeName: r.name, difficulty: r.difficulty, categoryId: r.categoryId, categoryName: r.categoryName, productQty: r.productQty, steps: [], isPublished: r.isPublished });
      setScreen({ type: 'edit-overview' });
    }}
    onBack={goDashboard} /></>);

  if (screen.type === 'edit-overview') return (<>{alertEl}<EditRecipeOverview
    mode={editCtx.mode} recipeId={editCtx.recipeId} recipeName={editCtx.recipeName}
    difficulty={editCtx.difficulty} categoryName={editCtx.categoryName} productQty={editCtx.productQty}
    isPublished={editCtx.isPublished} userRole={userRole}
    onEditMetadata={() => setScreen({ type: 'edit-metadata' })}
    onEditSteps={(steps) => { setEditCtx(p => ({ ...p, steps })); setScreen({ type: 'edit-steps' }); }}
    onTogglePublish={async () => {
      const action = editCtx.isPublished ? 'unpublish' : 'publish';
      try {
        const body: Record<string, unknown> = { action };
        if (editCtx.mode === 'cooking') body.product_tmpl_id = editCtx.recipeId; else body.bom_id = editCtx.recipeId;
        const res = await fetch('/api/recipes/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) {
          setEditCtx(p => ({ ...p, isPublished: !p.isPublished }));
          showToast(`Recipe ${action === 'publish' ? 'published' : 'unpublished'}!`, 'success');
        } else {
          const e = await res.json();
          showToast(`Failed: ${e.error}`, 'error');
        }
      } catch (_e) { showToast('Connection failed.', 'error'); }
    }}
    onDelete={async () => {
      try {
        const body: Record<string, unknown> = {};
        if (editCtx.mode === 'cooking') body.product_tmpl_id = editCtx.recipeId; else body.bom_id = editCtx.recipeId;
        const res = await fetch('/api/recipes/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) {
          showToast('Recipe deleted.', 'success');
          setTimeout(() => setScreen({ type: 'edit-browse' }), 1500);
        } else {
          const e = await res.json();
          showToast(`Failed: ${e.error}`, 'error');
        }
      } catch (_e) { showToast('Connection failed.', 'error'); }
    }}
    onBack={() => setScreen({ type: 'edit-browse' })} /></>);

  if (screen.type === 'edit-metadata') return (<>{alertEl}<EditMetadata
    mode={editCtx.mode} recipeName={editCtx.recipeName} difficulty={editCtx.difficulty}
    categoryId={editCtx.categoryId} productQty={editCtx.productQty}
    submitting={submitting}
    onSave={async (metadata) => {
      setSubmitting(true);
      try {
        const body: Record<string, unknown> = {
          name: metadata.name,
          x_recipe_category_id: metadata.categoryId,
          x_recipe_difficulty: metadata.difficulty || false,
        };
        if (editCtx.mode === 'cooking') body.product_tmpl_id = editCtx.recipeId; else { body.bom_id = editCtx.recipeId; body.product_qty = metadata.productQty; }
        const res = await fetch('/api/recipes/metadata', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) {
          setEditCtx(p => ({ ...p, recipeName: metadata.name, difficulty: metadata.difficulty, categoryId: metadata.categoryId, productQty: metadata.productQty }));
          showToast('Details updated!', 'success');
          setTimeout(() => setScreen({ type: 'edit-overview' }), 1000);
        } else {
          const e = await res.json();
          showToast(`Failed: ${e.error}`, 'error');
        }
      } catch (_e) { showToast('Connection failed.', 'error'); } finally { setSubmitting(false); }
    }}
    onBack={() => setScreen({ type: 'edit-overview' })} /></>);

  if (screen.type === 'edit-steps') {
    const canSaveDirect = userRole === 'admin' || userRole === 'manager';
    return (
    <>{alertEl}<RecordingSummary recipeName={editCtx.recipeName} recipeId={editCtx.recipeId} mode={editCtx.mode} steps={editCtx.steps}
      userRole={userRole}
      onEditStep={(i) => setScreen({ type: 'edit-step-detail', stepIndex: i })}
      onDeleteStep={(i) => setEditCtx(p => ({ ...p, steps: p.steps.filter((_, idx) => idx !== i) }))}
      onAddStep={() => { const b: RecordedStep = { id: `step_${Date.now()}`, step_type: 'prep', instruction: '', timer_seconds: 0, tip: '', photos: [], ingredientIds: [] }; const n = editCtx.steps.length; setEditCtx(p => ({ ...p, steps: [...p.steps, b] })); setScreen({ type: 'edit-step-detail', stepIndex: n }); }}
      onReorder={(reordered) => setEditCtx(p => ({ ...p, steps: reordered }))}
      submitting={submitting}
      toastMessage={toast?.msg} toastType={toast?.type} onDismissToast={() => setToast(null)}
      onSubmit={async () => {
        if (editCtx.recipeId <= 0) {
          showToast('Recipe must be linked to Odoo before saving.', 'error');
          return;
        }
        if (editCtx.steps.length === 0) { showToast('Add at least one step before saving.', 'error'); return; }
        const empty = editCtx.steps.filter(s => !s.instruction.trim());
        if (empty.length > 0) { showToast(`${empty.length} step(s) have no instructions. Edit them first.`, 'error'); return; }
        setSubmitting(true);
        try {
          const body: Record<string, unknown> = {
            steps: editCtx.steps.map(s => ({ step_type: s.step_type, instruction: s.instruction, timer_seconds: s.timer_seconds, tip: s.tip, images: s.photos.map(p => ({ data: p.split(',')[1] || p, source: 'edit' })) })),
            change_summary: 'Recipe steps edited',
            auto_publish: canSaveDirect,
          };
          if (editCtx.mode === 'cooking') body.product_tmpl_id = editCtx.recipeId; else body.bom_id = editCtx.recipeId;
          const res = await fetch('/api/recipes/steps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (res.ok) {
            showToast(canSaveDirect ? 'Recipe saved and published!' : 'Submitted for review!', 'success');
            setTimeout(() => setScreen({ type: 'edit-overview' }), 1500);
          } else {
            const e = await res.json();
            showToast(`Could not save: ${e.error || 'Unknown error'}`, 'error');
          }
        } catch (_e) { showToast('Connection failed. Please try again.', 'error'); } finally { setSubmitting(false); }
      }}
      onBack={() => setScreen({ type: 'edit-overview' })} /></>
    );
  }

  if (screen.type === 'edit-step-detail') {
    const step = editCtx.steps[screen.stepIndex];
    if (!step) { setScreen({ type: 'edit-steps' }); return null; }
    return <EditStep step={step} stepIndex={screen.stepIndex}
      onSave={(u) => { if (!u.instruction.trim()) setEditCtx(p => ({ ...p, steps: p.steps.filter((_, i) => i !== screen.stepIndex) })); else setEditCtx(p => ({ ...p, steps: p.steps.map((s, i) => i === screen.stepIndex ? u : s) })); setScreen({ type: 'edit-steps' }); }}
      onBack={() => { if (!step.instruction.trim()) setEditCtx(p => ({ ...p, steps: p.steps.filter((_, i) => i !== screen.stepIndex) })); setScreen({ type: 'edit-steps' }); }}
      />;
  }

  // ===== SETTINGS =====
  if (screen.type === 'settings') return (<>{alertEl}<SettingsPage notifSettings={notifSettings} onNotifChange={setNotifSettings} onBack={goDashboard} /></>);

  // ===== PLACEHOLDER =====
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {alertEl}
      {toast && <Toast message={toast.msg} type={toast.type} visible={true} onDismiss={() => setToast(null)} />}
      <div className="bg-[#2563EB] px-5 pt-12 pb-3 rounded-b-[28px]"><div className="flex items-center gap-3">
        <button onClick={goDashboard} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg></button>
        <div className="flex-1"><h1 className="text-[20px] font-bold text-white capitalize">{screen.type.replace(/-/g, ' ')}</h1></div>
      </div></div>
      <div className="flex-1 flex items-center justify-center p-8"><div className="text-center">
        <div className="text-5xl mb-4">{<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>}</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2 capitalize">{screen.type.replace(/-/g, ' ')}</h2>
        <p className="text-sm text-gray-500 mb-6">Coming soon</p>
        <button onClick={goDashboard} className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl active:bg-green-700">Back</button>
      </div></div>
    </div>
  );
}
