# BOM Step Instructions — Rich Text Editor

**Date:** 2026-04-19
**Module:** Manufacturing (Krawings Portal, Next.js 14)
**Scope:** Replace the plain textarea used to edit work order step instructions with a small rich text editor supporting bold, italic, underline, H2/H3, bullet list, numbered list, and link.

---

## Problem

Work order step instructions are stored on Odoo's `mrp.routing.workcenter.note` field, which is an HTML field. The portal already renders HTML correctly on the read side — see `WoDetail.tsx:375` (`dangerouslySetInnerHTML` with `sanitizeHtml`) and `BomDetail.tsx:788` (the read-only BOM view).

The edit side in `BomDetail.tsx:381` uses a plain `<textarea>` and strips HTML on display:

```tsx
<textarea value={op.note?.replace(/<[^>]*>/g, '') || ''} ... />
```

Consequences:
- Any formatting authored in Odoo disappears when an admin edits the step in the portal.
- Staff following the instructions can't see headings, emphasis, or lists.
- Users have asked for bold, underline, and bullet formatting.

## Goal

Allow users editing a BOM step to apply standard formatting that round-trips cleanly with Odoo. No changes to backend, data model, or sync logic.

## Non-goals

- No image upload in the editor (PDFs/Google Slides are handled separately via the worksheet field).
- No tables, code blocks, or colour.
- No editor-level paste sanitisation beyond Tiptap's defaults.
- No changes to read-only rendering in `WoDetail.tsx` or the BOM read view.

---

## Design

### New shared component

**File:** `src/components/ui/RichTextEditor.tsx`

```ts
interface RichTextEditorProps {
  value: string;              // HTML
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;         // default 120
  disabled?: boolean;         // default false
}
```

**Dependencies (new):**
- `@tiptap/react`
- `@tiptap/pm` (peer of the above)
- `@tiptap/starter-kit`
- `@tiptap/extension-underline`
- `@tiptap/extension-link`
- `@tiptap/extension-placeholder`

StarterKit provides bold, italic, bullet list, ordered list, and headings out of the box. Underline, Link, and Placeholder are separate extensions.

### Toolbar

Sticky row above the editor area with 8 buttons:

| Button | Format | Keyboard |
|--------|--------|----------|
| **B** | Bold | Cmd/Ctrl + B |
| *I* | Italic | Cmd/Ctrl + I |
| U | Underline | Cmd/Ctrl + U |
| H2 | Heading level 2 | — |
| H3 | Heading level 3 | — |
| • | Bullet list | — |
| 1. | Numbered list | — |
| 🔗 | Link (prompt for URL) | — |

**Button spec (matches mobile design system):**
- Size: 40 × 40 px (meets 44 px touch area with 4 px surrounding padding inside toolbar row)
- Default: `background #F5F6F8`, text `#6B7280`
- Active (cursor inside that format): `background #FFF4E6`, text `#F5800A`, border `1px solid #F5800A`
- Pressed: `transform: scale(0.97)`
- Border radius: 8 px
- Gap between buttons: 6 px

**Toolbar behaviour:**
- Horizontally scrollable if the viewport is narrow (`overflow-x: auto`, hide scrollbar)
- Sticks to the top of the editor container, not the page
- Link button: opens a `window.prompt('Link URL')`; empty string unlinks. Only `http://`, `https://`, and `mailto:` URLs are kept (stripped otherwise to prevent `javascript:` URLs).

### Editor area

- Min-height: 120 px (configurable via prop)
- Padding: 12 px
- Border: 1.5 px solid `#E8E8E8`, radius 8 px, background `#F5F6F8`
- Focus (when any child is focused): border `#F5800A`, box-shadow `0 0 0 3px rgba(245, 128, 10, 0.15)`, background `#FFFFFF`
- Placeholder shown when the document is empty (via `@tiptap/extension-placeholder`)

### Integration point

**File:** `src/components/manufacturing/BomDetail.tsx`

**Line 381 change:** replace

```tsx
<textarea value={op.note?.replace(/<[^>]*>/g, '') || ''}
          onChange={e => onChange({ note: e.target.value })}
          placeholder="Step-by-step instructions..."
          rows={3}
          className="..." />
```

with

```tsx
<RichTextEditor value={op.note || ''}
                onChange={html => onChange({ note: html })}
                placeholder="Step-by-step instructions..." />
```

No other file changes required. The existing Odoo save path already writes `op.note` as HTML.

### Data flow (unchanged)

1. BOM load → Odoo `mrp.routing.workcenter.note` (HTML) → `op.note` in state.
2. Editor mounts with `content={value}` — Tiptap parses HTML using enabled extensions. Unknown tags are dropped (safe).
3. On every transaction, `editor.getHTML()` is debounced (100 ms) and passed to `onChange`.
4. Save writes `op.note` back to Odoo unchanged.

### Sanitisation

- **Read side** — already handled by `sanitizeHtml` on display. No change.
- **Write side** — Tiptap only serialises nodes/marks it knows about. With our extension set, the output tag set is: `<p>`, `<strong>`, `<em>`, `<u>`, `<h2>`, `<h3>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<br>`. Everything else is dropped during parsing. No XSS surface is introduced.
- **Link URLs** — restricted via Tiptap's `Link.configure({ protocols: ['http', 'https', 'mailto'], validate: href => /^(https?:\/\/|mailto:)/i.test(href) })`.

### Mobile / touch

- Toolbar buttons: 40 px touch target, 6 px gap (meets Apple HIG 44 px + 8 px separation when counting outer padding).
- No hover-only states; all toolbar buttons have an `:active` scale-down.
- iOS Safari: `user-select: text` on editor area; no `touch-action: none`.
- Bullet continuation on Enter is handled by Tiptap (reliable across iOS/Android, unlike `execCommand`).

### Accessibility

- Each toolbar button has an `aria-label` ("Bold", "Italic", etc.) and `aria-pressed` reflecting active state.
- Toolbar is wrapped in `role="toolbar"` with `aria-label="Text formatting"`.
- Editor area has `aria-multiline="true"`.
- Keyboard shortcuts (Cmd/Ctrl + B / I / U) work out of the box via Tiptap.

---

## Risk

**Low.**
- New component is isolated; only one existing file (`BomDetail.tsx`) is modified.
- No schema, no API, no sync changes.
- Rollback: `git revert` the implementation commits.
- Bundle cost: ~50 KB gzipped, imported only where used. Not added to any global bundle.

---

## Reusability decision

Lives in `src/components/ui/RichTextEditor.tsx` (shared UI). This editor is a strong candidate for reuse in:
- Inventory template long descriptions
- HR employee notes
- Purchase order internal notes

Per the project rules, shared UI patterns belong in a shared location.

---

## Testing checklist

**Manual verification on staging (http://89.167.124.0:3000):**

1. Admin opens a BOM → edits a step → applies each format: bold, italic, underline, H2, H3, bullet list, numbered list, link.
2. Save the BOM, reload → formatting is preserved.
3. Open the related MO → WO → confirm `WoDetail.tsx` renders the formatted instructions correctly.
4. Create a link with `javascript:alert(1)` → should be rejected / not rendered as a link.
5. Edit an existing step whose `note` was plain text → opens cleanly; formatting can be added without breaking the text.
6. Edit an existing step whose `note` has Odoo-authored formatting → all tags render in the editor (bold, lists, etc.).
7. iOS Safari: toolbar buttons respond; bullet list continuation works on Enter.
8. Tab order: toolbar buttons reachable via keyboard; Cmd+B toggles bold.
9. Verify focus ring is orange, not blue.
10. Desktop view of `BomDetail.tsx` is unchanged outside the edit form.

**Build gate:**
- `npm run build` passes (TypeScript + lint).
- `.next/BUILD_ID` present before `systemctl restart krawings-portal`.

---

## Files to change

| File | Change |
|------|--------|
| `package.json` / `package-lock.json` | Add Tiptap deps |
| `src/components/ui/RichTextEditor.tsx` | New component (~150 lines) |
| `src/components/manufacturing/BomDetail.tsx` | Replace textarea at line 381 with `<RichTextEditor>` |

No other files touched.

---

## Branch & commit

- **Branch:** `feat/bom-step-rich-text`
- **Commits:**
  1. `[ADD] ui: RichTextEditor component (Tiptap)`
  2. `[IMP] manufacturing: rich text editor for BOM step instructions`

---

## Rollback

```bash
git revert <commit-hash-of-imp>
git revert <commit-hash-of-add>
git push
```

Or remove the Tiptap deps from `package.json` and the new component file if the dependency itself becomes a problem.
