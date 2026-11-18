import { between, children, descendants, type Node, type Op } from '../../shared/doc';
import { expand, instanceNode, isVirtual, splitVirtual } from '../../shared/components';
import { bounds, contains, handles, intersects, type Point, type Rect } from '../../shared/geometry';
import { hit, world } from '../geometry';
import type { Context, Tool } from './tool';
import { dragInsertion, isAutoLayout, layoutInsertions, reorderInAutoLayout } from '../autolayout';
import { gradientDown, gradientMove, gradientUp } from '../gradient-handles';
import { blocked, groupOps, normalizeGroups, outerGroup, ungroupOps } from '../../shared/layers';
import { snapped, clearSnap, roundUnlessSnapped } from '../snapping';
export class Select implements Tool {
    id = 'select';
    cursor = 'default';
    start?: Point;
    original = new Map<string, Node>();
    box?: Rect;
    handle = -1;
    moved = false;
    lastClick?: { time: number; x: number; y: number };
    constructor(public ctx: Context) { }
    selected() { return [...this.ctx.store.selection].map(id => this.ctx.store.doc.get(id)).filter((n): n is Node => !!n); }
    pick(p: Point, deep = false) { const { store, viewport } = this.ctx; const n = hit(expand(store.doc), p, 4 / viewport.zoom); return n && isVirtual(n.id) && !deep ? store.doc.get(splitVirtual(n.id).instance) : n; }
    deepSelect(p: Point) { const { store } = this.ctx; const n = this.pick(p, true); if (n) { store.selection.clear(); store.selection.add(n.id); store.changed(); } }
    onPointerDown(p: Point, e: PointerEvent) {
        if (gradientDown(this.ctx, p)) return;
        const { store, viewport } = this.ctx;
        const modified = e.ctrlKey || e.metaKey;
        if (modified && isVirtual(this.pick(p, true)?.id ?? '')) { this.deepSelect(p); return; }
        this.start = p;
        this.moved = false;
        layoutInsertions.delete(store);
        const resolved = expand(store.doc), nodes = this.selected().map(n => resolved.get(n.id)!);
        this.box = nodes.length ? bounds(nodes.map(n => world(resolved, n))) : undefined;
        this.handle = this.box && nodes.every(n => n.type !== 'text') ? handles(this.box).findIndex(h => Math.hypot(h.x - p.x, h.y - p.y) < 7 / viewport.zoom) : -1;
        const inner = this.pick(p);
        const double = this.lastClick && e.timeStamp - this.lastClick.time < 400 && Math.hypot(p.x - this.lastClick.x, p.y - this.lastClick.y) < 5 / viewport.zoom;
        this.lastClick = { time: e.timeStamp, ...p };
        const n = inner && (double || modified ? inner : outerGroup(store.doc, inner));
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
        this.original = new Map(this.selected().filter(n => !blocked(resolved, resolved.get(n.id)!) && !this.selected().some(a => a.id !== n.id && descendants(store.doc, a.id).some(d => d.id === n.id))).map(n => [n.id, { ...resolved.get(n.id)! }]));
        if (this.handle >= 0) for (const n of [...this.original.values()]) if (n.type === 'group') for (const c of descendants(store.doc, n.id)) if (!blocked(resolved, resolved.get(c.id)!)) this.original.set(c.id, { ...resolved.get(c.id)! });
        store.begin();
        store.changed();
    }
    onPointerMove(p: Point, e: PointerEvent) {
        if (e.buttons === 0 && this.start) return;
        if (gradientMove(this.ctx, p)) return;
        const { store, viewport } = this.ctx;
        if (!this.start) {
            this.ctx.hover = this.pick(p, e.ctrlKey || e.metaKey)?.id;
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
            const adjusted = snapped(this.ctx, { x, y, w, h }, e, { x: hx === .5 ? undefined : hx as 0 | 1, y: hy === .5 ? undefined : hy as 0 | 1 }, e.altKey);
            ({ x, y, w, h } = adjusted);
            for (const n of this.original.values()) {
                if ((hx !== .5 || e.shiftKey) && n.sizeW && n.sizeW !== 'fixed') ops.push({ t: 'set', id: n.id, key: 'sizeW', value: 'fixed' });
                if ((hy !== .5 || e.shiftKey) && n.sizeH && n.sizeH !== 'fixed') ops.push({ t: 'set', id: n.id, key: 'sizeH', value: 'fixed' });
                const snapshot = new Map(store.doc); for (const a of this.original.values()) snapshot.set(a.id, a);
                const r = world(snapshot, n);
                const parentNode = n.parent ? snapshot.get(n.parent) : undefined;
                const pr = parentNode ? world(snapshot, parentNode) : { x: 0, y: 0 };
                const parent = n.parent && this.original.has(n.parent) ? { x: x + (pr.x - b.x) * w / b.w, y: y + (pr.y - b.y) * h / b.h } : pr;
                const left = roundUnlessSnapped(this.ctx, x + (r.x - b.x) * w / b.w - parent.x), top = roundUnlessSnapped(this.ctx, y + (r.y - b.y) * h / b.h - parent.y);
                const right = roundUnlessSnapped(this.ctx, x + (r.x - b.x + n.w) * w / b.w - parent.x), bottom = roundUnlessSnapped(this.ctx, y + (r.y - b.y + n.h) * h / b.h - parent.y);
                const keepX = x === b.x && w === b.w, keepY = y === b.y && h === b.h;
                const values = { x: keepX ? n.x : left, y: keepY ? n.y : top, w: keepX ? n.w : Math.max(1, right - left), h: keepY ? n.h : Math.max(1, bottom - top) };
                for (const [key, value] of Object.entries(values))
                    ops.push({ t: 'set', id: n.id, key: key as 'x', value });
            }
        }
        else {
            const insertion = dragInsertion(store.doc, [...this.original.values()], p, this.start);
            if (insertion) layoutInsertions.set(store, insertion); else layoutInsertions.delete(store);
            this.ctx.invalidate();
            const b = bounds([...this.original.values()].map(n => world(store.doc, n)));
            const adjusted = snapped(this.ctx, { ...b, x: b.x + dx, y: b.y + dy }, e);
            dx = adjusted.x - b.x; dy = adjusted.y - b.y;
            for (const n of this.original.values())
                if (!isAutoLayout(store.doc.get(n.parent ?? '')))
                    ops.push({ t: 'set', id: n.id, key: 'x', value: roundUnlessSnapped(this.ctx, n.x + dx) }, { t: 'set', id: n.id, key: 'y', value: roundUnlessSnapped(this.ctx, n.y + dy) });
        }
        store.commit(ops);
    }
    onPointerUp(p: Point) { if (gradientUp(this.ctx)) return; if (!this.start) return; const { store } = this.ctx; if (this.ctx.marquee) {
        for (const n of store.doc.values())
            if (!blocked(store.doc, n) && intersects(world(store.doc, n), this.ctx.marquee))
                store.selection.add(outerGroup(store.doc, n).id);
        this.ctx.marquee = undefined;
    }
    else if (this.moved && this.handle < 0) {
        const insertion = dragInsertion(store.doc, [...this.original.values()], p, this.start!);
        if (insertion) reorderInAutoLayout(store, [...this.original.values()], insertion);
        else
        for (const id of this.original.keys()) {
            const n = store.doc.get(id)!;
            if (n.parent && store.doc.get(n.parent)?.type === 'group') continue;
            const original = this.original.get(id)!;
            const r = isAutoLayout(store.doc.get(original.parent ?? '')) ? world(store.doc, { ...original, x: original.x + p.x - this.start!.x, y: original.y + p.y - this.start!.y }) : world(store.doc, n);
            const blocked = new Set([id, ...descendants(store.doc, id).map(n => n.id)]);
            const frames = [...store.doc.values()].filter(f => f.type === 'frame' && !f.instanceOf && !blocked.has(f.id) && contains(world(store.doc, f), p));
            const parent = frames.sort((a, b) => descendants(store.doc, a.id).length - descendants(store.doc, b.id).length)[0];
            if ((parent?.id ?? null) !== n.parent) {
                const origin = parent ? world(store.doc, parent) : { x: 0, y: 0 };
                store.set(id, { parent: parent?.id ?? null, x: roundUnlessSnapped(this.ctx, r.x - origin.x), y: roundUnlessSnapped(this.ctx, r.y - origin.y), index: between(children(store.doc, parent?.id ?? null).at(-1)?.index ?? null) });
            }
        }
    } layoutInsertions.delete(store); clearSnap(this.ctx); if (this.moved && this.original.size) store.commit(normalizeGroups(store.doc)); store.end(); this.start = undefined; store.changed(); }
    onKey(e: KeyboardEvent) { const { store } = this.ctx; const nodes = this.selected().filter(n => !blocked(store.doc, n)); if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault(); store.begin(); const selection: string[] = [];
        if (e.shiftKey) { for (const n of nodes) if (n.type === 'group') { selection.push(...children(store.doc, n.id).map(c => c.id)); store.commit(ungroupOps(store.doc, n.id)); } }
        else { const ops = groupOps(store.doc, nodes.map(n => n.id)); const create = ops.find(op => op.t === 'create'); if (create?.t === 'create') selection.push(create.node.id); store.commit(ops); }
        store.selection.clear(); for (const id of selection) store.selection.add(id); store.end(); store.changed(); return;
    } if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        store.begin();
        store.commit(nodes.map(n => ({ t: 'delete', id: n.id })));
        if (nodes.length) store.commit(normalizeGroups(store.doc));
        store.end();
        store.selection.clear();
        store.changed();
    } const delta: Record<string, Point> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } }; if (delta[e.key]) {
        e.preventDefault();
        const d = delta[e.key], k = e.shiftKey ? 10 : 1;
        store.begin();
        for (const n of nodes.filter(n => !nodes.some(a => a.id !== n.id && descendants(store.doc, a.id).some(c => c.id === n.id))))
            store.set(n.id, { x: Math.round(n.x + d.x * k), y: Math.round(n.y + d.y * k) });
        if (nodes.length) store.commit(normalizeGroups(store.doc));
        store.end();
    } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const copies = new Map<string, Node>();
        for (const n of nodes) {
            if (n.component) {
                copies.set(n.id, instanceNode(n, n.x, n.y, n.parent, n.index));
                continue;
            }
            for (const c of [n, ...descendants(store.doc, n.id)])
                if (!copies.has(c.id))
                    copies.set(c.id, { ...c, id: crypto.randomUUID() });
        }
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
