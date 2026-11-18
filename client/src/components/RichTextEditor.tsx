import Image from '@tiptap/extension-image';
import LinkExt from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import { EditorContent, Mark, Node, mergeAttributes, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { MediaPicker } from './MediaPicker';
import { PROSE } from './ui';

// Pictures with captions (AI articles add "Photo by X on Unsplash" credits),
// image sizes (avoid layout shift) and superscript citation numbers survive editing.
const SizedImage = Image.extend({
  addAttributes() {
    return { ...this.parent?.(), width: { default: null }, height: { default: null } };
  },
});
const Figcaption = Node.create({
  name: 'figcaption',
  content: 'inline*',
  parseHTML: () => [{ tag: 'figcaption' }],
  renderHTML: ({ HTMLAttributes }) => ['figcaption', mergeAttributes(HTMLAttributes), 0],
});
const Figure = Node.create({
  name: 'figure',
  group: 'block',
  content: 'image figcaption?',
  isolating: true,
  draggable: true,
  parseHTML: () => [{ tag: 'figure' }],
  renderHTML: ({ HTMLAttributes }) => ['figure', mergeAttributes(HTMLAttributes), 0],
});
const Superscript = Mark.create({
  name: 'superscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: ({ HTMLAttributes }) => ['sup', mergeAttributes(HTMLAttributes), 0],
});

function Btn({ active, disabled, onClick, title, children }: { active?: boolean; disabled?: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded px-2 py-1 text-sm font-medium transition disabled:opacity-40 ${
        active ? 'bg-brand-600 text-white' : 'text-stone-700 hover:bg-stone-200 dark:text-stone-200 dark:hover:bg-stone-700'
      }`}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');

  const openLink = () => {
    setUrl(editor.getAttributes('link').href || 'https://');
    setLinkOpen(true);
  };
  const applyLink = (e: FormEvent) => {
    e.preventDefault();
    const href = url.trim();
    if (!href || href === 'https://') editor.chain().focus().extendMarkRange('link').unsetLink().run();
    else if (/^(https?:\/\/|mailto:)/i.test(href)) editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    else return;
    setLinkOpen(false);
  };

  const c = () => editor.chain().focus();
  return (
    <div className="border-b border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-800">
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5" role="toolbar" aria-label="Formatting">
        <Btn title="Bold" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}>
          <b>B</b>
        </Btn>
        <Btn title="Italic" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}>
          <i>I</i>
        </Btn>
        <Btn title="Underline" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}>
          <u>U</u>
        </Btn>
        <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}>
          <s>S</s>
        </Btn>
        <span className="mx-1 h-5 w-px bg-stone-300 dark:bg-stone-600" />
        <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>
          H2
        </Btn>
        <Btn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}>
          H3
        </Btn>
        <Btn title="Heading 4" active={editor.isActive('heading', { level: 4 })} onClick={() => c().toggleHeading({ level: 4 }).run()}>
          H4
        </Btn>
        <span className="mx-1 h-5 w-px bg-stone-300 dark:bg-stone-600" />
        <Btn title="Bulleted list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}>
          • List
        </Btn>
        <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>
          1. List
        </Btn>
        <Btn title="Quote" active={editor.isActive('blockquote')} onClick={() => c().toggleBlockquote().run()}>
          “ ”
        </Btn>
        <Btn title="Code block" active={editor.isActive('codeBlock')} onClick={() => c().toggleCodeBlock().run()}>
          {'</>'}
        </Btn>
        <Btn title="Horizontal line" onClick={() => c().setHorizontalRule().run()}>
          —
        </Btn>
        <span className="mx-1 h-5 w-px bg-stone-300 dark:bg-stone-600" />
        <Btn title="Link" active={editor.isActive('link')} onClick={openLink}>
          Link
        </Btn>
        <Btn title="Insert image" onClick={onImage}>
          Image
        </Btn>
        <span className="mx-1 h-5 w-px bg-stone-300 dark:bg-stone-600" />
        <Btn title="Undo" disabled={!editor.can().undo()} onClick={() => c().undo().run()}>
          ↶
        </Btn>
        <Btn title="Redo" disabled={!editor.can().redo()} onClick={() => c().redo().run()}>
          ↷
        </Btn>
      </div>
      {linkOpen && (
        <form onSubmit={applyLink} className="flex flex-wrap items-center gap-2 border-t border-stone-200 px-2 py-2 dark:border-stone-700">
          <label htmlFor="link-url" className="text-xs text-stone-500">
            Link URL
          </label>
          <input id="link-url" autoFocus className="input max-w-sm py-1" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com" />
          <button type="submit" className="btn btn-sm btn-primary">
            Apply
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').unsetLink().run();
              setLinkOpen(false);
            }}
          >
            Remove link
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setLinkOpen(false)}>
            Cancel
          </button>
        </form>
      )}
    </div>
  );
}

export function RichTextEditor({ value, onChange, placeholder = 'Start writing…' }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const [pickImage, setPickImage] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3, 4] } }),
      Underline,
      LinkExt.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto'] }),
      SizedImage,
      Figure,
      Figcaption,
      Superscript,
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    editorProps: { attributes: { class: `${PROSE} px-4 py-3`, 'aria-label': 'Article content' } },
    onUpdate: ({ editor: ed }) => onChange(ed.isEmpty ? '' : ed.getHTML()),
  });

  // Apply content that arrives from outside (loading an article, restoring a backup).
  useEffect(() => {
    if (!editor) return;
    const current = editor.isEmpty ? '' : editor.getHTML();
    if (value !== current) editor.commands.setContent(value || '', false);
  }, [value, editor]);

  if (!editor) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-stone-300 bg-white focus-within:border-brand-500 dark:border-stone-700 dark:bg-stone-900">
      <Toolbar editor={editor} onImage={() => setPickImage(true)} />
      <EditorContent editor={editor} />
      {pickImage && (
        <MediaPicker
          onClose={() => setPickImage(false)}
          onSelect={(m) => {
            if (m.credit?.html) {
              // Stock photos and AI pictures keep their credit as a caption.
              const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
              const size = m.width && m.height ? ` width="${m.width}" height="${m.height}"` : '';
              editor.chain().focus().insertContent(`<figure><img src="${esc(m.url)}" alt="${esc(m.alt || '')}"${size}><figcaption>${m.credit.html}</figcaption></figure>`).run();
            } else {
              editor.chain().focus().setImage({ src: m.url, alt: m.alt || '' }).run();
            }
            setPickImage(false);
          }}
        />
      )}
    </div>
  );
}
