'use client';

import React, { useState, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  TouchSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { RecordedStep, RecordedIngredient } from './ActiveRecording';
import Toast from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

interface Props {
  recipeName: string;
  recipeId: number;
  mode: 'cooking' | 'production';
  steps: RecordedStep[];
  ingredients?: RecordedIngredient[];
  userRole: string;
  onEditStep: (index: number) => void;
  onDeleteStep: (index: number) => void;
  onAddStep: () => void;
  onReorder: (steps: RecordedStep[]) => void;
  onSubmit: () => void;
  onBack: () => void;
  onHome: () => void;
  submitting: boolean;
  toastMessage?: string;
  toastType?: 'success' | 'error' | 'info';
  onDismissToast?: () => void;
}

const TYPE_EMOJI: Record<string, React.ReactNode> = { prep: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 2l10 10-3 3L3 5z"/><path d="M16 12l6 6-3 3-6-6"/></svg>, cook: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1012 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2z"/></svg>, plate: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg> };

// ===== Sortable Step Card =====
function SortableStepCard({ step, index, ingredients, onEdit, onDelete }: {
  step: RecordedStep; index: number; ingredients: RecordedIngredient[];
  onEdit: () => void; onDelete: () => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: step.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : 'auto' as number | string,
  };

  return (
    <div ref={setNodeRef} style={style} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-stretch">
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="w-10 flex-shrink-0 flex flex-col items-center justify-center bg-gray-50 border-r border-gray-100 cursor-grab active:cursor-grabbing touch-none"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2">
            <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
            <circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>
          </svg>
        </div>

        {/* Card content */}
        <div className="flex-1 p-3.5">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-[14px] flex-shrink-0">
              {TYPE_EMOJI[step.step_type] || <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 00-8 0v2"/></svg>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[12px] font-bold text-gray-500">Step {index + 1}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 capitalize">{step.step_type}</span>
                {step.timer_seconds > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-mono">{Math.ceil(step.timer_seconds / 60)}m</span>}
                {step.photos.length > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-50 text-green-600">{step.photos.length} photo{step.photos.length > 1 ? 's' : ''}</span>}
              </div>
              <div className="text-[13px] text-gray-800 line-clamp-2">{step.instruction}</div>
              {step.tip && <div className="text-[11px] text-amber-600 mt-1">{<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7V17h8v-2.3A7 7 0 0012 2z"/></svg>} {step.tip}</div>}
              {step.ingredientIds && step.ingredientIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {step.ingredientIds.map(iid => {
                    const ing = ingredients.find(i => i.id === iid);
                    if (!ing) return null;
                    return (
                      <span key={iid} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-100">
                        {ing.qty > 0 && <span className="font-mono mr-0.5">{ing.qty}{ing.uomName ? ` ${ing.uomName}` : ''}</span>}
                        {ing.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-gray-100">
            <button onClick={onEdit} className="flex-1 py-2 rounded-lg text-[12px] font-semibold text-blue-600 bg-blue-50 active:bg-blue-100">Edit</button>
            <button onClick={() => setShowDeleteConfirm(true)}
              className="flex-1 py-2 rounded-lg text-[12px] font-semibold text-red-600 bg-red-50 active:bg-red-100">Delete</button>
          </div>
          {showDeleteConfirm && (
            <ConfirmDialog
              title={`Delete step ${index + 1}?`}
              message="This step will be permanently removed."
              confirmLabel="Delete"
              cancelLabel="Keep"
              variant="danger"
              onConfirm={() => { setShowDeleteConfirm(false); onDelete(); }}
              onCancel={() => setShowDeleteConfirm(false)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Main Component =====
export default function RecordingSummary({
  recipeName, steps, ingredients = [], userRole,
  onEditStep, onDeleteStep, onAddStep, onReorder, onSubmit,
  onBack, onHome, submitting,
  toastMessage, toastType, onDismissToast,
}: Props) {
  const totalTime = steps.reduce((s, st) => s + (st.timer_seconds || 0), 0);
  const canSaveDirect = userRole === 'admin' || userRole === 'manager';

  // DnD sensors: touch with 200ms press delay to not interfere with scroll
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = steps.findIndex(s => s.id === active.id);
    const newIndex = steps.findIndex(s => s.id === over.id);
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(arrayMove(steps, oldIndex, newIndex));
    }
  }, [steps, onReorder]);

  const [reorderHint, setReorderHint] = useState(true);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Toast */}
      {toastMessage && onDismissToast && (
        <Toast message={toastMessage} type={toastType || 'info'} visible={!!toastMessage} onDismiss={onDismissToast} />
      )}

      <div className="bg-[#1A1F2E] px-5 pt-14 pb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 19l-7-7 7-7"/></svg>
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-bold text-white">Review Recording</h1>
            <p className="text-[12px] text-white/50 mt-0.5">{recipeName}</p>
          </div>
          <button onClick={onHome} className="w-9 h-9 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center active:bg-white/20">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>
          </button>
        </div>
      </div>
      <div className="px-5 pt-4 pb-32 flex-1">
        {/* Stats bar */}
        <div className="flex items-center gap-6 py-3 mb-4 bg-white rounded-xl border border-gray-200 px-4">
          <div className="text-center flex-1">
            <div className="text-[18px] font-bold text-gray-900 font-mono">{steps.length}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Steps</div>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <div className="text-center flex-1">
            <div className="text-[18px] font-bold text-gray-900 font-mono">{totalTime > 0 ? Math.ceil(totalTime / 60) : 0}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Minutes</div>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <div className="text-center flex-1">
            <div className="text-[18px] font-bold text-gray-900 font-mono">{ingredients.length}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Ingred.</div>
          </div>
          <div className="w-px h-8 bg-gray-100" />
          <div className="text-center flex-1">
            <div className="text-[18px] font-bold text-gray-900 font-mono">{steps.filter(s => s.photos.length > 0).length}</div>
            <div className="text-[10px] text-gray-400 font-semibold uppercase">Photos</div>
          </div>
        </div>

        {/* Reorder hint */}
        {reorderHint && steps.length > 1 && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-100 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2">
              <circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/>
              <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
            </svg>
            <span className="text-[12px] text-blue-700 flex-1">Hold and drag the dots to reorder steps</span>
            <button onClick={() => setReorderHint(false)} className="text-[11px] text-blue-500 font-semibold active:text-blue-700">Got it</button>
          </div>
        )}

        {/* Sortable step list */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={steps.map(s => s.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {steps.map((step, i) => (
                <SortableStepCard
                  key={step.id}
                  step={step}
                  index={i}
                  ingredients={ingredients}
                  onEdit={() => onEditStep(i)}
                  onDelete={() => onDeleteStep(i)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <button onClick={onAddStep}
          className="w-full mt-3 py-3 rounded-xl border-2 border-dashed border-gray-300 text-[13px] font-semibold text-gray-500 active:bg-gray-100">
          + Add step
        </button>
      </div>

      {/* Bottom action — role-based label */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-5 py-4 max-w-lg mx-auto">
        <button onClick={onSubmit} disabled={steps.length === 0 || submitting}
          className={`w-full py-4 rounded-2xl text-[16px] font-bold text-white transition-all ${
            steps.length > 0 && !submitting ? 'bg-green-600 shadow-lg active:bg-green-700' : 'bg-gray-300 cursor-not-allowed'
          }`}>
          {submitting
            ? (canSaveDirect ? 'Saving...' : 'Submitting...')
            : canSaveDirect
              ? `Save recipe (${steps.length} steps)`
              : `Submit for review (${steps.length} steps)`
          }
        </button>
      </div>
    </div>
  );
}
