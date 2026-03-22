/**
 * Krawings Recipe Guide Module — Type definitions
 */

// -- Odoo-sourced types (from krawings_recipe_config module) --

export interface OdooRecipeCategory {
  id: number;
  name: string;
  sequence: number;
  icon: string | false;
  mode: 'cooking_guide' | 'production_guide';
  warehouse_ids: number[];
  recipe_count: number;
}

export interface OdooRecipeStep {
  id: number;
  sequence: number;
  step_type: 'prep' | 'cook' | 'plate';
  instruction: string;
  timer_seconds: number;
  tip: string | false;
  ingredient_ids: number[];
  image_count: number;
  version_id: [number, string] | false;
}

export interface OdooRecipeStepImage {
  id: number;
  step_id: [number, string];
  caption: string | false;
  source: 'record' | 'upload';
  sort: number;
}

export interface OdooRecipeVersion {
  id: number;
  version: number;
  status: 'draft' | 'review' | 'approved' | 'rejected';
  change_summary: string | false;
  created_by_id: [number, string] | false;
  approved_by_id: [number, string] | false;
  approved_at: string | false;
  rejection_reason: string | false;
  create_date: string;
  step_ids: number[];
}

/** Cooking Guide recipe = product.template with x_recipe_guide=True */
export interface CookingGuideRecipe {
  id: number;
  name: string;
  x_recipe_guide: boolean;
  x_recipe_published: boolean;
  x_recipe_category_id: [number, string] | false;
  x_recipe_difficulty: 'easy' | 'medium' | 'hard' | false;
  x_recipe_step_count: number;
  categ_id: [number, string] | false;
  image_128: string | false;
}

/** Production Guide recipe = mrp.bom with x_recipe_guide=True */
export interface ProductionGuideRecipe {
  id: number;
  product_tmpl_id: [number, string];
  product_qty: number;
  code: string | false;
  x_recipe_guide: boolean;
  x_recipe_published: boolean;
  x_recipe_category_id: [number, string] | false;
  x_recipe_difficulty: 'easy' | 'medium' | 'hard' | false;
  x_cook_time_min: number;
  x_recipe_step_count: number;
  bom_line_ids: number[];
}

export interface OdooBomLine {
  id: number;
  product_id: [number, string];
  product_qty: number;
  product_uom_id: [number, string];
  child_bom_id: [number, string] | false;
}

// -- Portal-side types (SQLite cache + offline) --

export type SyncStatus = 'synced' | 'pending' | 'failed';
export type RecipeMode = 'cooking_guide' | 'production_guide';

export interface LocalRecipe {
  id: number;
  name: string;
  mode: RecipeMode;
  category_name: string;
  base_servings: number;
  unit: string;
  ingredients_json: string;
  odoo_id: number | null;
  odoo_synced: boolean;
  created_by: number;
  created_at: string;
}

export interface LocalIngredient {
  name: string;
  qty: number | null;
  unit: string;
}

export interface RecordingDraft {
  id: number;
  recipe_mode: RecipeMode;
  recipe_name: string;
  product_tmpl_id: number | null;
  bom_id: number | null;
  local_recipe_id: number | null;
  steps_json: string;
  total_seconds: number;
  status: 'recording' | 'done' | 'submitted';
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface RecordingStepDraft {
  step_number: number;
  step_type: 'prep' | 'cook' | 'plate';
  instruction: string;
  tip: string;
  timer_seconds: number;
  elapsed_seconds: number;
  ingredient_names: string[];
  photo_paths: string[];
  has_voice: boolean;
}

export interface SyncQueueItem {
  id: number;
  action: 'create_recipe' | 'submit_steps' | 'adjust_inventory' | 'deduct_stock';
  payload_json: string;
  status: 'pending' | 'processing' | 'done' | 'failed';
  error: string | null;
  attempts: number;
  created_at: string;
}

export interface CookSession {
  id: number;
  recipe_mode: RecipeMode;
  recipe_name: string;
  product_tmpl_id: number | null;
  bom_id: number | null;
  batch_size: number;
  batch_unit: string;
  started_at: string;
  completed_at: string | null;
  total_seconds: number;
  cooked_by: number;
  status: 'in_progress' | 'completed' | 'abandoned';
}

// -- API response types --

export interface RecipeListResponse {
  cooking_guide: CookingGuideRecipe[];
  production_guide: ProductionGuideRecipe[];
  categories: OdooRecipeCategory[];
}

export interface RecipeStepsResponse {
  steps: OdooRecipeStep[];
  ingredients: { id: number; name: string; qty: number; uom: string }[];
}

export interface PendingReviewResponse {
  id: number;
  recipe_name: string;
  recipe_type: RecipeMode;
  version: number;
  status: string;
  change_summary: string;
  created_by: string;
  created_at: string;
  step_count: number;
}
