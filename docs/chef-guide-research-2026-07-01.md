# Chef Guide — Research findings & recommendation (2026-07-01)

**Question:** make the Cooking Guide a real tool that guides staff through dishes
(photos, instructions, cooking times) for dishes a manager specifies — "like the
Production Guide."

## Bottom line

The tool already exists and works. Cooking Guide and Production Guide run the
**same engine** — same screens, same recipe-step model (`krawings.recipe.step`),
same photos / instructions / timers / ingredient-scaling in Cook Mode. There is
**no capability gap** between them.

Proof: production recipe **"Brown Stew Chicken"** (mrp.bom 14) is already a full
**7-step guide with 2 photos**. It's the working model of what every dish can be.

The only real difference: **Production auto-shows an ingredient list** (pulled from
the BOM), while **Cooking starts blank** until steps are recorded. That's the
"feels complete vs empty" perception — and it's now largely closed (ingredient
pull from BOM + the new Edit Amounts screen).

## The two real problems (not capability — content & authoring)

### 1. Content: almost no dishes have a guide recorded
Actual data (published guides):

| Recipe | Type | Steps | Photos |
|---|---|---|---|
| Brown Stew Chicken | Production | 7 | 2 |
| Jamaican Beef Patty Filling | Production | 5 | 0 |
| Jerk Chicken / Curry Powder / Oxtail / Hot Sauce | Production | 0 | 0 |
| Rice & Peas | Cooking | 4 | 0 |
| Coleslaw | Cooking | 1 | 0 |

Most recipes — both types — have **no step-by-step guide**. Production ones only
*look* done because the BOM ingredient list shows automatically.

### 2. Authoring friction: the recording flow is rough for a non-technical manager
The capability is all there, but these rough edges make building a guide painful
(from the code review):

- **Ingredients are awkward:** you must add every ingredient to one big list
  first, then tick which apply to each step. Quantities are recipe-wide, not
  per-step. You can't add a new ingredient inline while building a step.
- **Photos:** capture works, but there's **no preview before saving**, **no
  caption box**, and editing/replacing a photo only works **after** publishing.
- **No "save as draft":** it's finish-or-nothing; leaving mid-build loses work.
- **No preview** of how the instruction text will look to a cook.
- Minor: only 3 step types (prep/cook/plate), no step duplication, no voice notes.

Everything else (timers via preset buttons, drag-to-reorder steps, manager
auto-publish, Cook Mode playback with scaled ingredients) works well.

## Recommendation (prioritized)

**Goal:** a manager can specify a dish and easily build a photo+instruction+time
guide; cooking dishes get the same head start as production.

**Priority 1 — smooth the recording flow (the real enabler).**
- Inline "add ingredient" while building a step (no separate overlay trip).
- Photo preview + caption in the recording/summary screen; allow remove/replace
  before publishing.
- "Save as draft → continue later."
These three remove most of the pain of building a guide.

**Priority 2 — one-tap head start for cooking dishes.**
- A "Pull ingredients from a production recipe" button (I did this by hand for
  Rice & Peas / Coleslaw; make it a self-serve action). So a new cooking dish
  isn't blank.

**Priority 3 — polish / nice-to-have.**
- Per-step ingredient quantity override, step duplication, photo captions in Cook
  Mode, extra step types.

**Also worth doing regardless:** actually record guides for the handful of dishes
that matter most (using Brown Stew Chicken as the template). The tool is ready;
the content is the missing piece.

## Files (for implementers)
Authoring: `ActiveRecording.tsx`, `RecordingSummary.tsx`, `EditStep.tsx`,
`EditIngredients.tsx`. Playback: `CookMode.tsx`. Save/read:
`api/recipes/steps/route.ts`, `api/recipes/ingredients/route.ts`.
Orchestrator: `app/recipes/page.tsx`.
