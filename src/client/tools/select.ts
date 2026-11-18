import { between, children, descendants, type Node, type Op } from '../../shared/doc';
import { bounds, contains, handles, intersects, type Point, type Rect } from '../../shared/geometry';
import { hit, world } from '../geometry';
import type { Context, Tool } from './tool';
import { dragInsertion, isAutoLayout, layoutInsertions, reorderInAutoLayout } from '../autolayout';
export class Select implements Tool {
    id = 'select';
    cursor = 'default';
    start?: Point;
    original = new Map<string, Node>();
    box?: Rect;
    handle = -1;
    moved = false;
    constructor(public ctx: Context) { }
    selected() { return [...this.ctx.store.selection].map(id => this.ctx.store.doc.get(id)).filter((n): n is Node => !!n); }
    onPointerDown(p: Point, e: PointerEvent) {
        const { store, viewport } = this.ctx;
        this.start = p;
        this.moved = false;
        layoutInsertions.delete(store);
        const nodes = this.selected();
        this.box = nodes.length ? bounds(nodes.map(n => world(store.doc, n))) : undefined;
        this.handle = this.box && nodes.every(n => n.type !== 'text') ? handles(this.box).findIndex(h => Math.hypot(h.x - p.x, h.y - p.y) < 7 / viewport.zoom) : -1;
        const n = hit(store.doc, p);
        if (this.handle < 0) {
            if (n) {
                if (e.shiftKey) {
                    if (store.selection.has(n.id))
                        store.selection.delete(n.id);
                    else
                        store.selection.add(n.id);
                }
                else if (!store.selection.has(n.id)) {
                    store.selection.clear();
                    store.selection.add(n.id);
                }
            }
            else {
                if (!e.shiftKey)
                    store.selection.clear();
                this.ctx.marquee = { ...p, w: 0, h: 0 };
            }
        }
        this.original = new Map(this.selected().filter(n => !this.selected().some(a => a.id !== n.id && descendants(store.doc, a.id).some(d => d.id === n.id))).map(n => [n.id, { ...n }]));
        store.begin();
        store.changed();
    }
    onPointerMove(p: Point, e: PointerEvent) {
        const { store, viewport } = this.ctx;
        if (!this.start) {
            this.ctx.hover = hit(store.doc, p)?.id;
            this.ctx.invalidate();
            return;
        }
        const dx = p.x - this.start.x, dy = p.y - this.start.y;
        if (Math.hypot(dx, dy) > 2 / viewport.zoom)
            this.moved = true;
        if (this.ctx.marquee) {
            this.ctx.marquee = { x: Math.min(p.x, this.start.x), y: Math.min(p.y, this.start.y), w: Math.abs(dx), h: Math.abs(dy) };
            this.ctx.invalidate();
            return;
        }
        if (!this.moved)
            return;
        const ops: Op[] = [];
        if (this.handle >= 0 && this.box) {
            const b = this.box;
            const hx = [0, .5, 1, 1, 1, .5, 0, 0][this.handle], hy = [0, 0, 0, .5, 1, 1, 1, .5][this.handle];
            let x = b.x, y = b.y, w = b.w, h = b.h;
            if (hx !== .5) {
                w = Math.max(1, b.w + dx * (hx === 0 ? -1 : 1) * (e.altKey ? 2 : 1));
                x = e.altKey ? b.x + (b.w - w) / 2 : hx === 0 ? b.x + b.w - w : b.x;
            }
            if (hy !== .5) {
                h = Math.max(1, b.h + dy * (hy === 0 ? -1 : 1) * (e.altKey ? 2 : 1));
                y = e.altKey ? b.y + (b.h - h) / 2 : hy === 0 ? b.y + b.h - h : b.y;
            }
            if (e.shiftKey) {
                const scale = Math.max(w / b.w, h / b.h);
                w = b.w * scale;
                h = b.h * scale;
                x = e.altKey ? b.x + (b.w - w) / 2 : hx === 0 ? b.x + b.w - w : b.x;
                y = e.altKey ? b.y + (b.h - h) / 2 : hy === 0 ? b.y + b.h - h : b.y;
            }
            for (const n of this.original.values()) {
                if ((hx !== .5 || e.shiftKey) && n.sizeW && n.sizeW !== 'fixed') ops.push({ t: 'set', id: n.id, key: 'sizeW', value: 'fixed' });
                if ((hy !== .5 || e.shiftKey) && n.sizeH && n.sizeH !== 'fixed') ops.push({ t: 'set', id: n.id, key: 'sizeH', value: 'fixed' });
                const r = world(store.doc, { ...n });
                const parent = n.parent ? world(store.doc, store.doc.get(n.parent)!) : { x: 0, y: 0 };
                const values = { x: x + (r.x - b.x) * w / b.w - parent.x, y: y + (r.y - b.y) * h / b.h - parent.y, w: n.w * w / b.w, h: n.h * h / b.h };
                for (const [key, value] of Object.entries(values))
                    ops.push({ t: 'set', id: n.id, key: key as 'x', value });
            }
        }
        else {
            const insertion = dragInsertion(store.doc, [...this.original.values()], p, this.start);
            if (insertion) layoutInsertions.set(store, insertion); else layoutInsertions.delete(store);
            this.ctx.invalidate();
            for (const n of this.original.values())
                if (!isAutoLayout(store.doc.get(n.parent ?? '')))
                    ops.push({ t: 'set', id: n.id, key: 'x', value: n.x + dx }, { t: 'set', id: n.id, key: 'y', value: n.y + dy });
        }
        store.commit(ops);
    }
    onPointerUp(p: Point) { const { store } = this.ctx; if (this.ctx.marquee) {
        for (const n of store.doc.values())
            if (intersects(world(store.doc, n), this.ctx.marquee))
                store.selection.add(n.id);
        this.ctx.marquee = undefined;
    }
    else if (this.moved && this.handle < 0) {
        const insertion = dragInsertion(store.doc, [...this.original.values()], p, this.start!);
        if (insertion) reorderInAutoLayout(store, [...this.original.values()], insertion);
        else
        for (const id of this.original.keys()) {
            const n = store.doc.get(id)!;
            const original = this.original.get(id)!;
            const r = isAutoLayout(store.doc.get(original.parent ?? '')) ? world(store.doc, { ...original, x: original.x + p.x - this.start!.x, y: original.y + p.y - this.start!.y }) : world(store.doc, n);
            const blocked = new Set([id, ...descendants(store.doc, id).map(n => n.id)]);
            const frames = [...store.doc.values()].filter(f => f.type === 'frame' && !blocked.has(f.id) && contains(world(store.doc, f), p));
            const parent = frames.sort((a, b) => descendants(store.doc, a.id).length - descendants(store.doc, b.id).length)[0];
            if ((parent?.id ?? null) !== n.parent) {
                const origin = parent ? world(store.doc, parent) : { x: 0, y: 0 };
                store.set(id, { parent: parent?.id ?? null, x: r.x - origin.x, y: r.y - origin.y, index: between(children(store.doc, parent?.id ?? null).at(-1)?.index ?? null) });
            }
        }
    } layoutInsertions.delete(store); store.end(); this.start = undefined; store.changed(); }
    onKey(e: KeyboardEvent) { const { store } = this.ctx; const nodes = this.selected(); if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.commit(nodes.map(n => ({ t: 'delete', id: n.id })));
        store.selection.clear();
    } const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }; if (delta[e.key]) {
        e.preventDefault();
        const d = delta[e.key], k = e.shiftKey ? 10 : 1;
        store.begin();
        for (const n of nodes)
            store.set(n.id, { x: n.x + d.x * k, y: n.y + d.y * k });
        store.end();
    } if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        const copies = new Map<string, Node>();
        for (const n of nodes)
            for (const c of [n, ...descendants(store.doc, n.id)])
                if (!copies.has(c.id))
                    copies.set(c.id, { ...c, id: crypto.randomUUID() });
        for (const [old, n] of copies) {
            const original = store.doc.get(old)!;
            n.parent = copies.get(original.parent ?? '')?.id ?? original.parent;
            if (!copies.has(original.parent ?? '')) {
                n.x += 20;
                n.y += 20;
                n.index = between(children(store.doc, n.parent).at(-1)?.index ?? null);
            }
        }
        store.commit([...copies.values()].map(node => ({ t: 'create', node })));
        store.selection.clear();
        for (const n of nodes)
            store.selection.add(copies.get(n.id)!.id);
        store.changed();
    } }
}
