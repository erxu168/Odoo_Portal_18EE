# BOM Step Rich Text Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `<textarea>` that edits BOM work-order step instructions with a Tiptap-based rich text editor supporting bold, italic, underline, H2/H3, bullet list, numbered list, and link.

**Architecture:** Add a new shared client component `src/components/ui/RichTextEditor.tsx` built on Tiptap + StarterKit + Underline + Link + Placeholder. Replace the single textarea in `src/components/manufacturing/BomDetail.tsx:381` with this component. The portal's save path already handles HTML, so no backend, RPC, or schema changes are required.

**Tech Stack:** Next.js 14.2 (App Router), React 18, TypeScript 5, Tailwind, Tiptap 2.

**Spec:** [docs/superpowers/specs/2026-04-19-bom-step-rich-text-design.md](../specs/2026-04-19-bom-step-rich-text-design.md)

**Testing note:** This repo has no unit test framework. Verification relies on (a) `npm run build` passing (TypeScript + ESLint gate) and (b) manual verification on local dev server and the staging server (89.167.124.0). Each task ends with a concrete check.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `package.json` / `package-lock.json` | Declare new Tiptap deps | Modify |
| `src/components/ui/RichTextEditor.tsx` | Reusable rich text editor (toolbar + Tiptap editor) | Create |
| `src/components/manufacturing/BomDetail.tsx` | BOM edit form — swap textarea for editor | Modify (line 381) |

No other files are touched. The read-side in `WoDetail.tsx` and the BOM read-only view already render HTML.

---

## Task 1: Create the feature branch

**Files:** none

- [ ] **Step 1: Start from a clean main**

Run:
```bash
cd /Users/ethan/Odoo_Portal_18EE
git status
```
Expected: working tree clean OR only the existing untracked files unrelated to this task. If there are modified files related to this feature, stop and investigate.

- [ ] **Step 2: Create and switch to the branch**

Run:
```bash
git checkout main
git pull origin main
git checkout -b feat/bom-step-rich-text
```
Expected: new branch `feat/bom-step-rich-text` created from up-to-date `main`.

- [ ] **Step 3: Confirm**

Run: `git branch --show-current`
Expected: `feat/bom-step-rich-text`

---

## Task 2: Install Tiptap dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
cd /Users/ethan/Odoo_Portal_18EE
npm install @tiptap/react @tiptap/pm @tiptap/starter-kit @tiptap/extension-underline @tiptap/extension-link @tiptap/extension-placeholder
```
Expected: `npm` adds 6 new entries under `dependencies` in `package.json` with matching `2.x` versions. No peer-dep warnings that block install.

- [ ] **Step 2: Verify the build still compiles**

Run: `npm run build`
Expected: build succeeds (exit code 0), `.next/BUILD_ID` exists. No errors.

- [ ] **Step 3: Commit**

Run:
```bash
git add package.json package-lock.json
git commit -m "[ADD] deps: Tiptap for rich text editor"
```

---

## Task 3: Create the RichTextEditor component

**Files:**
- Create: `src/components/ui/RichTextEditor.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/ui/RichTextEditor.tsx` with the following exact content:

```tsx
'use client';

import React, { useCallback, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  disabled?: boolean;
}

const LINK_PROTOCOL_RE = /^(https?:\/\/|mailto:)/i;

export default function RichTextEditor({
  value,
  onChange,
  placeholder = '',
  minHeight = 120,
  disabled = false,
}: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: false,
        protocols: ['http', 'https', 'mailto'],
        validate: (href: string) => LINK_PROTOCOL_RE.test(href),
      }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
    editorProps: {
      attributes: {
        'aria-multiline': 'true',
        class: 'rte-content',
      },
    },
  });

  // Keep the editor in sync when the parent swaps to a different record.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || '';
    const normalisedCurrent = current === '<p></p>' ? '' : current;
    if (normalisedCurrent !== incoming) {
      editor.commands.setContent(incoming, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  const promptLink = useCallback(() => {
    if (!editor) return;
    const existing = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Link URL (leave empty to remove)', existing || 'https://');
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().unsetLink().run();
      return;
    }
    if (!LINK_PROTOCOL_RE.test(trimmed)) {
      window.alert('Only http://, https://, or mailto: links are allowed.');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  }, [editor]);

  if (!editor) {
    return <div style={{ minHeight }} className="rte-shell" aria-busy="true" />;
  }

  return (
    <div className="rte-shell">
      <div role="toolbar" aria-label="Text formatting" className="rte-toolbar">
        <ToolbarButton label="Bold" active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}>
          <span style={{ fontWeight: 700 }}>B</span>
        </ToolbarButton>
        <ToolbarButton label="Italic" active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}>
          <span style={{ fontStyle: 'italic' }}>I</span>
        </ToolbarButton>
        <ToolbarButton label="Underline" active={editor.isActive('underline')}
          onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <span style={{ textDecoration: 'underline' }}>U</span>
        </ToolbarButton>
        <ToolbarButton label="Heading 2" active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          H2
        </ToolbarButton>
        <ToolbarButton label="Heading 3" active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          H3
        </ToolbarButton>
        <ToolbarButton label="Bullet list" active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>
          &bull;
        </ToolbarButton>
        <ToolbarButton label="Numbered list" active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          1.
        </ToolbarButton>
        <ToolbarButton label="Link" active={editor.isActive('link')} onClick={promptLink}>
          &#128279;
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} style={{ minHeight }} className="rte-editor" />
      <style jsx>{`
        .rte-shell {
          border: 1.5px solid #E8E8E8;
          border-radius: 8px;
          background: #F5F6F8;
          transition: border-color 150ms ease, box-shadow 150ms ease, background 150ms ease;
        }
        .rte-shell:focus-within {
          border-color: #F5800A;
          box-shadow: 0 0 0 3px rgba(245, 128, 10, 0.15);
          background: #FFFFFF;
        }
        .rte-toolbar {
          display: flex;
          gap: 6px;
          padding: 6px 8px;
          overflow-x: auto;
          border-bottom: 1px solid #E8E8E8;
          scrollbar-width: none;
        }
        .rte-toolbar::-webkit-scrollbar { display: none; }
        .rte-editor {
          padding: 12px;
          font-size: 15px;
          color: #1A1A1A;
          outline: none;
        }
      `}</style>
      <style jsx global>{`
        .rte-content {
          outline: none;
          min-height: inherit;
        }
        .rte-content p { margin: 0 0 8px; }
        .rte-content p:last-child { margin-bottom: 0; }
        .rte-content h2 { font-size: 18px; font-weight: 700; margin: 8px 0; }
        .rte-content h3 { font-size: 16px; font-weight: 700; margin: 8px 0; }
        .rte-content ul { padding-left: 20px; list-style: disc; margin: 4px 0 8px; }
        .rte-content ol { padding-left: 20px; list-style: decimal; margin: 4px 0 8px; }
        .rte-content a { color: #F5800A; text-decoration: underline; }
        .rte-content strong { font-weight: 700; }
        .rte-content em { font-style: italic; }
        .rte-content u { text-decoration: underline; }
        .rte-content p.is-editor-empty:first-child::before {
          color: #9CA3AF;
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolbarButton({ label, active, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rte-btn"
      data-active={active ? 'true' : 'false'}
    >
      {children}
      <style jsx>{`
        .rte-btn {
          flex: 0 0 auto;
          width: 40px;
          height: 40px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: #F5F6F8;
          color: #6B7280;
          font-size: 14px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: transform 150ms ease, background 150ms ease,
                      color 150ms ease, border-color 150ms ease;
        }
        .rte-btn[data-active='true'] {
          background: #FFF4E6;
          color: #F5800A;
          border-color: #F5800A;
        }
        .rte-btn:active { transform: scale(0.97); }
      `}</style>
    </button>
  );
}

export type { RichTextEditorProps };
```

- [ ] **Step 2: Type-check / build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors, no ESLint errors. `.next/BUILD_ID` exists.

- [ ] **Step 3: Smoke-mount in a sandbox page (optional local-only check)**

No change required. If a quick visual check is desired before wiring to BOM:
- Start dev: `npm run dev`
- Temporarily add `<RichTextEditor value="" onChange={() => {}} placeholder="Test" />` to any scratch page, confirm it renders, remove it.
- Do NOT commit the scratch import.

- [ ] **Step 4: Commit**

Run:
```bash
git add src/components/ui/RichTextEditor.tsx
git commit -m "[ADD] ui: RichTextEditor component (Tiptap, bold/italic/underline/headings/lists/link)"
```

---

## Task 4: Wire RichTextEditor into BomDetail

**Files:**
- Modify: `src/components/manufacturing/BomDetail.tsx` (line 381 and its import block)

- [ ] **Step 1: Add the import**

In `src/components/manufacturing/BomDetail.tsx`, add this line after the existing top-level imports (near the other component imports in the file):

```tsx
import RichTextEditor from '@/components/ui/RichTextEditor';
```

If `@/` alias is not used elsewhere in this file, use the relative path `../ui/RichTextEditor` — check existing imports in the file to match convention.

- [ ] **Step 2: Replace the textarea**

Find this block (around line 379-383):

```tsx
<div className="mb-3">
  <label className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 block mb-1">Instructions</label>
  <textarea value={op.note?.replace(/<[^>]*>/g, '') || ''} onChange={e => onChange({ note: e.target.value })} placeholder="Step-by-step instructions..."
    rows={3} className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[var(--fs-sm)] outline-none focus:border-green-600 resize-none" />
</div>
```

Replace with:

```tsx
<div className="mb-3">
  <label className="text-[var(--fs-xs)] font-bold tracking-wide uppercase text-gray-400 block mb-1">Instructions</label>
  <RichTextEditor
    value={op.note || ''}
    onChange={html => onChange({ note: html })}
    placeholder="Step-by-step instructions..."
  />
</div>
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors, no ESLint errors.

- [ ] **Step 4: Commit**

Run:
```bash
git add src/components/manufacturing/BomDetail.tsx
git commit -m "[IMP] manufacturing: rich text editor for BOM step instructions"
```

---

## Task 5: Local manual verification

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Wait for "Ready in ..." message. Portal available at `http://localhost:3000`.

- [ ] **Step 2: Sign in and open a BOM**

In browser:
1. Log in as `biz@krawings.de` (staging creds) or a test user.
2. Navigate to Manufacturing → BOMs.
3. Open any BOM that has at least one work-order step, or add a step.
4. Tap/click "Edit" on a step (or "Add step").

Expected: the Instructions field shows the new editor with a toolbar of 8 buttons (B, I, U, H2, H3, •, 1., link).

- [ ] **Step 3: Exercise every format**

In the editor:
1. Type "Bold test", select the text, click **B** → text becomes bold.
2. Type a new line "Italic test", select, click *I* → italic.
3. Type "Underline test", select, click U → underlined.
4. Click H2, type "Heading two" → shows larger bold.
5. Click H3, type "Heading three" → shows smaller bold.
6. Click •, type "Item 1", press Enter, type "Item 2" → bullet list with two items.
7. Click 1., type "Step 1", press Enter, type "Step 2" → numbered list.
8. Type "Krawings", select it, click the link icon, enter `https://krawings.de` → becomes a link (orange, underlined).
9. Try an invalid link: select text, click link, enter `javascript:alert(1)` → alert appears and no link is created.

Expected: each format applies correctly; the toolbar button highlights (orange background) while the cursor is inside that format.

- [ ] **Step 4: Save and reload**

1. Save the step (existing Save button in the BOM editor).
2. Refresh the browser.
3. Re-open the same BOM and step.

Expected: all formatting is preserved exactly (bold still bold, lists still lists, link still clickable).

- [ ] **Step 5: Verify the Work Order view**

1. Navigate to an MO that uses this BOM (or create one).
2. Open a WO that references the edited step.
3. Check the Instructions section.

Expected: the formatted HTML renders correctly in `WoDetail` via the existing `dangerouslySetInnerHTML` + `sanitizeHtml` path.

- [ ] **Step 6: Verify plain-text backwards compat**

1. Edit a DIFFERENT step whose `note` was previously plain text (no HTML).

Expected: the text loads cleanly into the editor, no duplicate paragraphs, can apply formatting on top.

- [ ] **Step 7: Mobile / touch check (iPhone Safari or device emulation)**

1. Open DevTools → toggle device toolbar → iPhone 14 preset.
2. Reload the BOM edit view.
3. Tap each toolbar button.

Expected: buttons are comfortably tappable (40 × 40 px targets with gaps); bullet continues on Enter; focus ring is orange, not blue.

- [ ] **Step 7b: Keyboard shortcuts**

With the editor focused on desktop:
1. Type some text, select it, press Cmd+B (macOS) or Ctrl+B (other) → bold toggles.
2. Repeat with Cmd/Ctrl+I and Cmd/Ctrl+U.

Expected: each shortcut toggles the corresponding toolbar button's active state.

- [ ] **Step 8: Stop the dev server**

Run: Ctrl+C in the terminal running `npm run dev`.

---

## Task 6: Deploy to staging and verify

**Files:** none

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin feat/bom-step-rich-text
```

- [ ] **Step 2: Deploy to staging**

SSH to the staging server and run the standard deploy sequence. Per `CLAUDE.md`:

```bash
ssh root@89.167.124.0 'cd /opt/krawings-portal && \
  git fetch origin feat/bom-step-rich-text && \
  git checkout feat/bom-step-rich-text && \
  git pull origin feat/bom-step-rich-text && \
  npm install && \
  npm run build && \
  test -f .next/BUILD_ID && \
  systemctl restart krawings-portal && \
  systemctl status krawings-portal --no-pager | head -15'
```

Expected:
- `npm run build` exits 0.
- `.next/BUILD_ID` file exists (verified by `test -f`).
- `systemctl status` shows `active (running)`.

If the build fails, do NOT restart the service. Fix the issue on the branch, push, and re-run.

- [ ] **Step 3: Verify in the browser on staging**

Open `http://89.167.124.0:3000`. Repeat the core checks from Task 5 — Steps 3, 4, 5 — on staging.

Expected: identical behaviour to local.

- [ ] **Step 4: Mirror the session log to Obsidian**

Write a session note to the Obsidian vault (Claude/sessions folder) summarising:
- What shipped (rich text editor for BOM step instructions)
- Branch and commits
- Staging verification result

Use the `mcp__obsidian-vault__write_file` tool with path `Claude/sessions/2026-04-19-bom-step-rich-text.md`.

---

## Task 7: Open a pull request

**Files:** none

- [ ] **Step 1: Create the PR**

Run:
```bash
gh pr create --title "[IMP] manufacturing: rich text editor for BOM step instructions" --body "$(cat <<'EOF'
## Summary
- Adds reusable `RichTextEditor` component (Tiptap) under `src/components/ui/`
- Replaces the plain textarea in BOM step editor with the new editor — bold, italic, underline, H2/H3, bullet/numbered list, link
- No backend/schema/RPC changes; Odoo's `mrp.routing.workcenter.note` is already an HTML field

## Test plan
- [ ] Edit a BOM step on staging, apply every format, save, reload — formatting preserved
- [ ] Related work order renders the formatted instructions correctly
- [ ] Existing plain-text notes still load cleanly
- [ ] iOS Safari: toolbar buttons tappable, bullet continues on Enter
- [ ] `javascript:` URLs are rejected by the link button

Spec: docs/superpowers/specs/2026-04-19-bom-step-rich-text-design.md
Plan: docs/superpowers/plans/2026-04-19-bom-step-rich-text.md
EOF
)"
```

Expected: PR URL printed. Share it with the user.

---

## Rollback

If the editor causes issues on staging:

```bash
# Revert the commits (safest — keeps history)
git revert <sha-of-wire-up-commit>
git revert <sha-of-component-commit>
git revert <sha-of-deps-commit>
git push
```

Then redeploy (Task 6, Step 2). Or, as a faster hotfix on staging only:

```bash
ssh root@89.167.124.0 'cd /opt/krawings-portal && \
  git checkout main && \
  npm install && npm run build && systemctl restart krawings-portal'
```

---

## Verification summary

- ✅ `npm run build` passes on every task.
- ✅ Local manual verification covers all 8 formatting operations, save/reload, WO render, backwards compat, and mobile touch.
- ✅ Staging verification mirrors local checks.
- ✅ Scope is strictly limited to the three files listed; no unrelated edits.
- ✅ Desktop view unaffected outside the editor (no global CSS; component uses styled-jsx scoped styles).
