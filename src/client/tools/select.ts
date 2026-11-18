import { between, children, descendants, type Node, type Op } from '../../shared/doc';
import { bounds, contains, handles, intersects, inverse, matrixAngle, parentMatrix, transform, type Point, type Rect } from '../../shared/geometry';
import { aabb, hit, nodeHandles, sizeOf, worldMatrix } from '../geometry';
import type { Context, Tool } from './tool';
import { blocked, groupOps, moveOps, normalizeGroups, outerGroup, rotateOps, ungroupOps } from '../../shared/layers';
import { dragInsertion, isAutoLayout, layoutInsertions, reorderInAutoLayout } from '../autolayout';
import { gradientDown, gradientMove, gradientUp } from '../gradient-handles';
import { snapped, clearSnap } from '../snapping';
export class Select implements Tool {
    id = 'select';
    cursor = 'default';
    start?: Point;
    original = new Map<string, Node>();
    box?: Rect;
    handle = -1;
    moved = false;
    rotating = false;
    snapshot = new Map<string, Node>();
    rotateCursor = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'24\' height=\'24\' viewBox=\'0 0 24 24\'%3E%3Cpath d=\'M5 10a8 8 0 1 1 1 9M5 4v6h6\' fill=\'none\' stroke=\'black\' stroke-width=\'1.5\'/%3E%3C/svg%3E") 12 12, crosshair';
    lastClick?: { time: number; x: number; y: number };
    constructor(public ctx: Context) { }
    selected() { return [...this.ctx.store.selection].map(id => this.ctx.store.doc.get(id)).filter((n): n is Node => !!n); }
    selectionHandles(nodes = this.selected()) { const doc = this.ctx.store.doc; return nodes.length === 1 ? nodeHandles(doc, nodes[0]) : handles(bounds(nodes.map(n => aabb(doc, n)))); }
    rotationHit(p: Point, nodes = this.selected()) { if (!nodes.length || nodes.some(n => blocked(this.ctx.store.doc, n))) return false; const hs = this.selectionHandles(nodes), c = { x: (hs[0].x + hs[4].x) / 2, y: (hs[0].y + hs[4].y) / 2 }; return [0, 2, 4, 6].some(i => { const h = hs[i], d = Math.hypot(p.x - h.x, p.y - h.y) * this.ctx.viewport.zoom; return d >= 8 && d <= 16 && (p.x - h.x) * (h.x - c.x) + (p.y - h.y) * (h.y - c.y) > 0; }); }
    onPointerDown(p: Point, e: PointerEvent) {
        if (gradientDown(this.ctx, p)) return;
        const { store, viewport } = this.ctx;
        this.start = p;
        this.moved = false;
        layoutInsertions.delete(store);
        const nodes = this.selected();
        this.box = nodes.length ? bounds(nodes.map(n => aabb(store.doc, n))) : undefined;
        this.rotating = this.rotationHit(p, nodes);
        this.handle = this.box && nodes.every(n => n.type !== 'text') ? this.selectionHandles(nodes).findIndex(h => Math.hypot(h.x - p.x, h.y - p.y) < 7 / viewport.zoom) : -1;
        const inner = hit(store.doc, p, 4 / viewport.zoom);
        const double = this.lastClick && e.timeStamp - this.lastClick.time < 400 && Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 5 / viewport.zoom;
        this.lastClick = { time: e.timeStamp, ...p };
        const n = inner && (double ? inner : outerGroup(store.doc, inner));
        if (this.handle < 0 && !this.rotating) {
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
        this.original = new Map(this.selected().filter(n => !blocked(store.doc, n) && !this.selected().some(a => a.id !== n.id && descendants(store.doc, a.id).some(d => d.id === n.id))).map(n => [n.id, { ...n }]));
        if (this.handle >= 0) for (const n of [...this.original.values()]) if (n.type === 'group') for (const c of descendants(store.doc, n.id)) if (!blocked(store.doc, c)) this.original.set(c.id, { ...c });
        this.snapshot = new Map(store.doc);
        store.begin();
        store.changed();
    }
    onPointerMove(p: Point, e: PointerEvent) {
        if (gradientMove(this.ctx, p)) return;
        const { store, viewport } = this.ctx;
        if (!this.start) {
            this.cursor = this.rotationHit(p) ? this.rotateCursor : 'default';
            this.ctx.hover = hit(store.doc, p, 4 / viewport.zoom)?.id;
            this.ctx.invalidate();
            return;
        }
        let dx = p.x - this.start.x, dy = p.y - this.start.y;
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
        if (this.rotating && this.box) {
            const c = { x: this.box.x + this.box.w / 2, y: this.box.y + this.box.h / 2 };
            let angle = (Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(this.start.y - c.y, this.start.x - c.x)) * 180 / Math.PI;
            if (e.shiftKey) { const n = this.original.size === 1 ? [...this.original.values()][0] : undefined, initial = n?.rotation ?? 0; angle = Math.round((initial + angle) / 15) * 15 - initial; }
            store.commit(rotateOps(this.snapshot, [...this.original.keys()], c, angle, sizeOf));
            return;
        }
        if (this.handle >= 0 && this.box) {
            const selected = this.selected(), single = selected.length === 1 ? this.original.get(selected[0].id) : undefined;
            const m = single ? worldMatrix(this.snapshot, single) : undefined;
            if (m) { const a = transform(inverse(m), this.start), b = transform(inverse(m), p); dx = b.x - a.x; dy = b.y - a.y; }
            const b = single ? { x: 0, y: 0, w: single.w, h: single.h } : this.box;
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
            const edges = { x: hx === .5 ? undefined : hx as 0 | 1, y: hy === .5 ? undefined : hy as 0 | 1 };
            let adjusted = { x, y, w, h };
            if (!single) adjusted = snapped(this.ctx, adjusted, e, edges, e.altKey);
            else if (Math.abs(matrixAngle(m!)) < 1e-8) { const r = snapped(this.ctx, { ...adjusted, x: x + m![4], y: y + m![5] }, e, edges, e.altKey); adjusted = { ...r, x: r.x - m![4], y: r.y - m![5] }; }
            ({ x, y, w, h } = adjusted);
            const resized = new Map(this.snapshot);
            for (const n of this.original.values()) {
                if ((hx !== .5 || e.shiftKey) && n.sizeW && n.sizeW !== 'fixed') ops.push({ t: 'set', id: n.id, key: 'sizeW', value: 'fixed' });
                if ((hy !== .5 || e.shiftKey) && n.sizeH && n.sizeH !== 'fixed') ops.push({ t: 'set', id: n.id, key: 'sizeH', value: 'fixed' });
                const r = aabb(this.snapshot, n), nw = Math.max(1, n.w * w / b.w), nh = Math.max(1, n.h * h / b.h);
                const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, origin = single ? transform(inverse(m!), c) : c;
                const scaled = { x: x + (origin.x - b.x) * w / b.w, y: y + (origin.y - b.y) * h / b.h };
                const point = single ? transform(m!, scaled) : scaled;
                const local = transform(inverse(parentMatrix(resized, n)), point);
                const size = sizeOf({ ...n, w: nw, h: nh });
                const values = { x: local.x - size.w / 2, y: local.y - size.h / 2, w: nw, h: nh };
                resized.set(n.id, { ...n, ...values });
                for (const [key, value] of Object.entries(values))
                    ops.push({ t: 'set', id: n.id, key: key as 'x', value });
            }
        }
        else {
            const insertion = dragInsertion(store.doc, [...this.original.values()], p, this.start);
            if (insertion) layoutInsertions.set(store, insertion); else layoutInsertions.delete(store);
            this.ctx.invalidate();
            const b = bounds([...this.original.values()].map(n => aabb(this.snapshot, n)));
            const adjusted = snapped(this.ctx, { ...b, x: b.x + dx, y: b.y + dy }, e);
            dx = adjusted.x - b.x; dy = adjusted.y - b.y;
            for (const n of this.original.values()) { if (isAutoLayout(store.doc.get(n.parent ?? ''))) continue; const m = inverse(parentMatrix(this.snapshot, n)), a = transform(m, { x: 0, y: 0 }), b = transform(m, { x: dx, y: dy });
                ops.push({ t: 'set', id: n.id, key: 'x', value: n.x + b.x - a.x }, { t: 'set', id: n.id, key: 'y', value: n.y + b.y - a.y }); }
        }
        store.commit(ops);
    }
    onPointerUp(p: Point) { if (gradientUp(this.ctx)) return; const { store } = this.ctx; if (this.ctx.marquee) {
        for (const n of store.doc.values())
            if (!blocked(store.doc, n) && intersects(aabb(store.doc, n), this.ctx.marquee))
                store.selection.add(outerGroup(store.doc, n).id);
        this.ctx.marquee = undefined;
    }
    else if (this.moved && this.handle < 0 && !this.rotating) {
        const insertion = dragInsertion(store.doc, [...this.original.values()], p, this.start!);
        if (insertion) reorderInAutoLayout(store, [...this.original.values()], insertion);
        else
        for (const id of this.original.keys()) {
            const n = store.doc.get(id)!;
            if (n.parent && store.doc.get(n.parent)?.type === 'group') continue;
            const blocked = new Set([id, ...descendants(store.doc, id).map(n => n.id)]);
            const frames = [...store.doc.values()].filter(f => f.type === 'frame' && !blocked.has(f.id) && contains({ x: 0, y: 0, w: f.w, h: f.h }, transform(inverse(worldMatrix(store.doc, f)), p)));
            const parent = frames.sort((a, b) => descendants(store.doc, a.id).length - descendants(store.doc, b.id).length)[0];
            if ((parent?.id ?? null) !== n.parent) {
                const shadow = new Map(store.doc), original = this.original.get(id)!;
                if (isAutoLayout(store.doc.get(original.parent ?? ''))) {
                    const m = inverse(parentMatrix(this.snapshot, original)), a = transform(m, { x: 0, y: 0 }), b = transform(m, { x: p.x - this.start!.x, y: p.y - this.start!.y });
                    shadow.set(id, { ...n, x: original.x + b.x - a.x, y: original.y + b.y - a.y });
                }
                store.commit(moveOps(shadow, id, parent?.id ?? null, {}, sizeOf));
            }
        }
    } layoutInsertions.delete(store); clearSnap(this.ctx); if (this.moved && this.original.size) store.commit(normalizeGroups(store.doc, sizeOf)); store.end(); this.start = undefined; store.changed(); }
    onKey(e: KeyboardEvent) { const { store } = this.ctx; const nodes = this.selected().filter(n => !blocked(store.doc, n)); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault(); store.begin(); const selection: string[] = [];
        if (e.shiftKey) { for (const n of nodes) if (n.type === 'group') { selection.push(...children(store.doc, n.id).map(c => c.id)); store.commit(ungroupOps(store.doc, n.id, sizeOf)); } }
        else { const ops = groupOps(store.doc, nodes.map(n => n.id), sizeOf); const create = ops.find(op => op.t === 'create'); if (create?.t === 'create') selection.push(create.node.id); store.commit(ops); }
        store.selection.clear(); for (const id of selection) store.selection.add(id); store.end(); store.changed(); return;
    } if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.begin();
        store.commit(nodes.map(n => ({ t: 'delete', id: n.id })));
        if (nodes.length) store.commit(normalizeGroups(store.doc, sizeOf));
        store.end();
        store.selection.clear();
    } const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }; if (delta[e.key]) {
        e.preventDefault();
        const d = delta[e.key], k = e.shiftKey ? 10 : 1;
        store.begin();
        for (const n of nodes.filter(n => !nodes.some(a => a.id !== n.id && descendants(store.doc, a.id).some(c => c.id === n.id)))) { const m = inverse(parentMatrix(store.doc, n)), a = transform(m, { x: 0, y: 0 }), b = transform(m, { x: d.x * k, y: d.y * k });
            store.set(n.id, { x: n.x + b.x - a.x, y: n.y + b.y - a.y }); }
        if (nodes.length) store.commit(normalizeGroups(store.doc, sizeOf));
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
