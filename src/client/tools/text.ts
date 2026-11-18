import { between, children, isTextNode, makeNode, maxTextLength, type Doc, type TextNode } from '../../shared/doc';
import { corners, identity, inverse, matrixAngle, multiply, transform, type Point, type Rect } from '../../shared/geometry';
import { hit, world, worldMatrix } from '../geometry';
import { fontFamilies, lineHeight } from '../text-layout';
import { textChange } from '../../shared/text-edit';
import type { Context, Tool } from './tool';

export function textEditorClip(doc: Doc, node: TextNode, r: Rect): string {
    const editor = worldMatrix(doc, node);
    let polygon = corners({ x: 0, y: 0, w: r.w, h: r.h });
    let clipped = false, aligned = true;
    const seen = new Set([node.id]);
    for (let id = node.parent; id && !seen.has(id);) {
        seen.add(id);
        const parent = doc.get(id);
        if (!parent) break;
        id = parent.parent;
        if (parent.type !== 'frame') continue;
        const toFrame = multiply(inverse(worldMatrix(doc, parent)), editor);
        aligned &&= Math.abs(toFrame[0] * toFrame[1]) < 1e-9;
        const edges = [(p: Point) => p.x, (p: Point) => parent.w - p.x, (p: Point) => p.y, (p: Point) => parent.h - p.y];
        for (const distance of edges) {
            const offsets = polygon.map(p => distance(transform(toFrame, p)));
            if (offsets.every(d => d >= -1e-9)) continue;
            clipped = true;
            polygon = polygon.flatMap((p, i) => {
                const j = (i + 1) % polygon.length, q = polygon[j];
                const a = offsets[i], b = offsets[j];
                const inside = a >= -1e-9, nextInside = b >= -1e-9;
                if (inside === nextInside) return inside ? [p] : [];
                const t = a / (a - b);
                const crossing = { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
                return inside ? [p, crossing] : [crossing];
            });
            if (polygon.length < 3) return 'inset(100%)';
        }
    }
    if (!clipped) return '';
    const px = (n: number) => `${Number(n.toFixed(8))}px`;
    if (!aligned) return `polygon(${polygon.map(p => `${px(p.x)} ${px(p.y)}`).join(', ')})`;
    const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
    return `inset(${[Math.min(...ys), r.w - Math.max(...xs), r.h - Math.max(...ys), Math.min(...xs)].map(px).join(' ')})`;
}

export class TextEditor {
    private input?: HTMLTextAreaElement;
    private composing = false;
    private displayedText = '';

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
        this.displayedText = input.value;
        const write = () => {
            if (input.value.length > maxTextLength) {
                alert(`Text is limited to ${maxTextLength.toLocaleString()} characters. Your edit has not been saved; shorten it before leaving the editor.`);
                return;
            }
            store.editText(node.id, this.displayedText, input.value);
            this.update();
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
        if (!this.composing) {
            this.displayedText = value;
            if (input.value !== value) {
                const { selectionStart, selectionEnd, selectionDirection } = input;
                const { start, end, insert } = textChange(input.value, value);
                const move = (p: number) => p < start ? p : p >= end ? p + insert.length - (end - start) : start + insert.length;
                input.value = value;
                input.setSelectionRange(move(selectionStart), move(selectionEnd), selectionDirection);
            }
        }
        const r = world(store.doc, node), m = worldMatrix(store.doc, node), p = viewport.screen(transform(m, { x: 0, y: 0 })), auto = node.textWidth === 'auto';
        const box = { ...r, w: auto ? Math.max(12, Math.ceil(r.w) + 2) : r.w, h: Math.ceil(r.h) + 1 };
        input.wrap = auto ? 'off' : 'soft';
        Object.assign(input.style, {
            left: `${p.x}px`,
            top: `${p.y}px`,
            width: `${box.w}px`,
            height: `${box.h}px`,
            clipPath: textEditorClip(store.doc, node, box),
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
