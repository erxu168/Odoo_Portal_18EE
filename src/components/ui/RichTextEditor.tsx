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

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || '';
    const normalisedCurrent = current === '<p></p>' ? '' : current;
    if (normalisedCurrent !== incoming) {
      editor.commands.setContent(incoming, { emitUpdate: false });
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
