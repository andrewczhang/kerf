import { between, children, isTextNode, makeNode, maxTextLength, type TextNode } from '../../shared/doc';
import { identity, inverse, matrixAngle, transform, type Point } from '../../shared/geometry';
import { hit, world, worldMatrix } from '../geometry';
import { fontFamilies, lineHeight } from '../text-layout';
import type { Context, Tool } from './tool';

export class TextEditor {
    private input?: HTMLTextAreaElement;
    private composing = false;

    constructor(private ctx: Context, private canvas: HTMLCanvasElement) {
        ctx.store.addEventListener('change', this.update);
        canvas.addEventListener('pointerdown', e => {
            if (this.input && this.input.value.length > maxTextLength) {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.input.focus();
            }
        }, true);
    }

    open(node: TextNode, creating = false) {
        if (this.close() === false) return;
        const { store } = this.ctx;
        const input = document.createElement('textarea');
        this.input = input;
        input.className = 'text-editor';
        input.setAttribute('aria-label', 'Edit canvas text');
        input.spellcheck = false;
        input.value = node.text;
        const write = () => {
            if (input.value.length > maxTextLength) {
                alert(`Text is limited to ${maxTextLength.toLocaleString()} characters. Your edit has not been saved; shorten it before leaving the editor.`);
                return;
            }
            const current = store.doc.get(node.id);
            if (isTextNode(current) && input.value !== current.text)
                store.set(node.id, { text: input.value });
        };
        input.addEventListener('compositionstart', () => { this.composing = true; });
        input.addEventListener('compositionend', () => { this.composing = false; write(); });
        input.oninput = () => { if (!this.composing) write(); };
        input.onkeydown = e => {
            if (!e.isComposing && (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey)))) {
                e.preventDefault();
                if (input.value.length <= maxTextLength) this.canvas.focus();
            }
        };
        input.onblur = () => this.close();
        this.ctx.editingText = node.id;
        store.selection.clear();
        store.selection.add(node.id);
        this.canvas.parentElement!.append(input);
        store.begin();
        if (creating)
            store.commit([{ t: 'create', node }]);
        else
            store.changed();
        input.focus();
        if (creating)
            input.select();
        else
            input.setSelectionRange(input.value.length, input.value.length);
    }

    close() {
        if (!this.input)
            return;
        if (this.input.value.length > maxTextLength) {
            this.input.focus();
            return false;
        }
        this.input.onblur = null;
        this.input.remove();
        this.input = undefined;
        this.composing = false;
        this.ctx.editingText = undefined;
        this.ctx.store.end();
        this.ctx.invalidate();
    }

    update = () => {
        const input = this.input, { store, viewport, editingText } = this.ctx;
        if (!input || !editingText)
            return;
        if (input.value.length > maxTextLength) return;
        const node = store.doc.get(editingText);
        if (!isTextNode(node) || !store.selection.has(node.id)) {
            this.close();
            return;
        }
        const value = node.text.replace(/\r\n?/g, '\n');
        if (!this.composing && input.value !== value) {
            const { selectionStart, selectionEnd, selectionDirection } = input;
            input.value = value;
            input.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
        }
        const r = world(store.doc, node), m = worldMatrix(store.doc, node), p = viewport.screen(transform(m, { x: 0, y: 0 })), auto = node.textWidth === 'auto';
        input.wrap = auto ? 'off' : 'soft';
        Object.assign(input.style, {
            left: `${p.x}px`,
            top: `${p.y}px`,
            width: `${auto ? Math.max(12, Math.ceil(r.w) + 2) : r.w}px`,
            height: `${Math.ceil(r.h) + 1}px`,
            transform: `rotate(${matrixAngle(m)}deg) scale(${viewport.zoom})`,
            fontFamily: fontFamilies[node.fontFamily],
            fontSize: `${node.fontSize}px`,
            fontWeight: String(node.fontWeight),
            lineHeight: `${lineHeight(node)}px`,
            textAlign: node.textAlign,
            color: node.fill,
            opacity: String(node.opacity),
        });
    };
}

export class TextTool implements Tool {
    id = 'text';
    cursor = 'text';
    onPointerDown() { }
    onPointerMove() { }
    constructor(private ctx: Context, private edit: (node: TextNode, creating?: boolean) => void) { }
    onPointerUp(p: Point) {
        const { store } = this.ctx;
        const target = hit(store.doc, p);
        if (isTextNode(target)) {
            this.edit(target);
            return;
        }
        const frame = target?.type === 'frame' ? target : target?.parent ? store.doc.get(target.parent) : undefined;
        const parent = frame?.instanceOf ? undefined : frame;
        const local = transform(inverse(parent ? worldMatrix(store.doc, parent) : identity), p);
        const index = between(children(store.doc, parent?.id ?? null).at(-1)?.index ?? null);
        const node = makeNode('text', local.x, local.y, index);
        node.parent = parent?.id ?? null;
        this.edit(node, true);
    }
}
