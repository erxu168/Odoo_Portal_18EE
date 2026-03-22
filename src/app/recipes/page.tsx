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

interface StepData {
  id: number; sequence: number; step_type: string; instruction: string;
  timer_seconds: number; tip: string; image_count: number;
  ingredients: { id: number; name: string; uom: string }[];
}

interface RecipeContext {
  mode: 'cooking' | 'production';
  recipeId: number;
  recipeName: string;
  difficulty?: string;
  categoryName?: string;
  productQty?: number;
  ingredientCount?: number;
  steps: StepData[];
  batch: number;
  multiplier: number;
}

type Screen =
  | { type: 'dashboard' }
  | { type: 'cooking-guide' }
  | { type: 'production-guide' }
  | { type: 'overview' }
  | { type: 'batch-size' }
  | { type: 'ingredient-check' }
  | { type: 'cook-mode' }
  | { type: 'complete'; elapsed: number }
  | { type: 'record' }
  | { type: 'edit' }
  | { type: 'approvals' }
  | { type: 'stats' };

export default function RecipesPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>({ type: 'dashboard' });
  const [userRole, setUserRole] = useState<string>('staff');
  const [ctx, setCtx] = useState<RecipeContext>({
    mode: 'cooking', recipeId: 0, recipeName: '', steps: [], batch: 1, multiplier: 1,
  });

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (d.user?.role) setUserRole(d.user.role);
    }).catch(() => {});
  }, []);

  function goHome() { router.push('/'); }
  function goDashboard() { setScreen({ type: 'dashboard' }); }

  if (screen.type === 'dashboard') {
    return <RecipeDashboard userRole={userRole} onNavigate={(id: string) => setScreen({ type: id } as Screen)} onHome={goHome} />;
  }

  if (screen.type === 'cooking-guide') {
    return (
      <CookingGuideBrowse userRole={userRole}
        onSelectRecipe={(recipe) => {
          const cat = recipe.x_recipe_category_id;
          setCtx({ mode: 'cooking', recipeId: recipe.id, recipeName: recipe.name,
            difficulty: recipe.x_recipe_difficulty || undefined,
            categoryName: cat ? cat[1] : undefined, steps: [], batch: 1, multiplier: 1 });
          setScreen({ type: 'overview' });
        }}
        onBack={goDashboard} onHome={goHome} />
    );
  }

  if (screen.type === 'production-guide') {
    return (
      <ProductionGuideBrowse userRole={userRole}
        onSelectRecipe={(recipe) => {
          const name = recipe.product_tmpl_id ? recipe.product_tmpl_id[1] : `BoM #${recipe.id}`;
          const cat = recipe.x_recipe_category_id;
          setCtx({ mode: 'production', recipeId: recipe.id, recipeName: name,
            difficulty: recipe.x_recipe_difficulty || undefined,
            categoryName: cat ? cat[1] : undefined, productQty: recipe.product_qty,
            ingredientCount: recipe.bom_line_ids?.length || 0, steps: [], batch: 10, multiplier: 1 });
          setScreen({ type: 'overview' });
        }}
        onBack={goDashboard} onHome={goHome} />
    );
  }

  if (screen.type === 'overview') {
    return (
      <RecipeOverview mode={ctx.mode} recipeId={ctx.recipeId} recipeName={ctx.recipeName}
        difficulty={ctx.difficulty} categoryName={ctx.categoryName} productQty={ctx.productQty}
        onBack={() => setScreen({ type: ctx.mode === 'cooking' ? 'cooking-guide' : 'production-guide' })}
        onHome={goHome}
        onStartCooking={(steps) => { setCtx(prev => ({ ...prev, steps })); setScreen({ type: 'batch-size' }); }} />
    );
  }

  if (screen.type === 'batch-size') {
    return (
      <BatchSize mode={ctx.mode} recipeName={ctx.recipeName}
        baseBatch={ctx.mode === 'cooking' ? 1 : (ctx.productQty || 10)}
        onBack={() => setScreen({ type: 'overview' })} onHome={goHome}
        onConfirm={(batch, multiplier) => { setCtx(prev => ({ ...prev, batch, multiplier })); setScreen({ type: 'ingredient-check' }); }} />
    );
  }

  if (screen.type === 'ingredient-check') {
    return (
      <IngredientCheck mode={ctx.mode} recipeName={ctx.recipeName} steps={ctx.steps} multiplier={ctx.multiplier}
        onBack={() => setScreen({ type: 'batch-size' })} onHome={goHome}
        onStartCook={() => setScreen({ type: 'cook-mode' })} />
    );
  }

  if (screen.type === 'cook-mode') {
    return (
      <CookMode mode={ctx.mode} recipeName={ctx.recipeName} steps={ctx.steps}
        batch={ctx.batch} multiplier={ctx.multiplier}
        onExit={goDashboard}
        onComplete={(elapsed) => setScreen({ type: 'complete', elapsed })} />
    );
  }

  if (screen.type === 'complete') {
    return (
      <CookComplete mode={ctx.mode} recipeName={ctx.recipeName}
        stepCount={ctx.steps.length} elapsedSeconds={screen.elapsed} batch={ctx.batch}
        onDashboard={goDashboard}
        onCookAnother={() => setScreen({ type: ctx.mode === 'cooking' ? 'cooking-guide' : 'production-guide' })} />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5 relative overflow-hidden">
        <div className="flex items-center gap-3 relative">
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
          <p className="text-sm text-gray-500 mb-6">This screen is connected to the backend and ready for UI.</p>
          <button onClick={goDashboard} className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl active:bg-green-700">Back to Recipe Guide</button>
        </div>
      </div>
    </div>
  );
}
