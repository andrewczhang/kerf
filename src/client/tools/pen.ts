import { between, children, makeNode, type Node } from '../../shared/doc';
import { hit, world, type Point } from '../../shared/geometry';
import { MAX_POINTS, corner, fit, nearest, reverse, smooth, snap45, split, toAbs, trace, type PathPoint } from '../../shared/path';
import type { Context, Tool } from './tool';

type Part = { kind: 'anchor' | 'in' | 'out'; index: number };
type Drag = { kind: 'anchor' | 'in' | 'out' | 'handles'; index: number; start: Point; abs: PathPoint[]; moved: boolean; free?: boolean };

const ORANGE = '#ff4f00', PAPER = '#fbfbf9';

/** Pen: click adds corners, drag pulls bezier handles, click the first anchor to close. With a path selected it edits anchors and handles. */
export class Pen implements Tool {
    id = 'pen';
    cursor = 'crosshair';
    ownsSelection = true;
    drawing = false;
    sel = -1;
    drag?: Drag;
    hover?: Point;
    lastDown = { index: -1, time: 0 };
    constructor(public ctx: Context, public exit: () => void) { }

    path(): Node | undefined {
        const s = this.ctx.store.selection;
        if (s.size !== 1) return;
        const n = this.ctx.store.doc.get([...s][0]);
        return n?.type === 'path' && n.points ? n : undefined;
    }
    abs(n: Node) { return toAbs(n.points!, world(this.ctx.store.doc, n)); }
    origin(n: Node): Point { const p = n.parent ? this.ctx.store.doc.get(n.parent) : undefined; return p ? world(this.ctx.store.doc, p) : { x: 0, y: 0 }; }
    write(n: Node, abs: PathPoint[], closed = !!n.closed) {
        if (abs.length > MAX_POINTS) return false;
        const f = fit(abs, closed, this.origin(n));
        this.ctx.store.set(n.id, { x: f.x, y: f.y, w: f.w, h: f.h, points: f.points, ...(closed !== !!n.closed ? { closed } : {}) });
        return true;
    }
    /** Handles are shown for the selected anchor, its neighbours and the anchor being drawn. */
    shows(abs: PathPoint[], closed: boolean, i: number) {
        const n = abs.length, s = this.sel;
        if (this.drawing && i === n - 1) return true;
        if (s < 0 || s >= n) return false;
        return i === s || i === s - 1 || i === s + 1 || closed && (i === (s + 1) % n || i === (s - 1 + n) % n);
    }
    pick(abs: PathPoint[], closed: boolean, p: Point, tol: number): Part | undefined {
        const near = (x: number, y: number) => Math.hypot(p.x - x, p.y - y) <= tol;
        for (let i = abs.length - 1; i >= 0; i--) {
            const a = abs[i];
            if (!this.shows(abs, closed, i)) continue;
            if ((a.ox !== a.x || a.oy !== a.y) && near(a.ox, a.oy)) return { kind: 'out', index: i };
            if ((a.ix !== a.x || a.iy !== a.y) && near(a.ix, a.iy)) return { kind: 'in', index: i };
        }
        for (let i = abs.length - 1; i >= 0; i--) if (near(abs[i].x, abs[i].y)) return { kind: 'anchor', index: i };
    }

    activate() { this.drawing = false; this.sel = -1; if (this.ctx.store.selection.size && !this.path()) { this.ctx.store.selection.clear(); this.ctx.store.changed(); } }
    deactivate() { this.finish(); this.sel = -1; this.drag = undefined; this.hover = undefined; }
    /** Stop appending; a path left with a single anchor is removed. */
    finish() {
        if (!this.drawing) return;
        this.drawing = false;
        const n = this.path();
        if (n && n.points!.length < 2) {
            const store = this.ctx.store, own = (c: { after: { t: string; id?: string; node?: Node } }) => (c.after.node?.id ?? c.after.id) === n.id;
            if (store.group) store.group = store.group.filter(c => !own(c));
            while (store.undoStack.at(-1)?.every(own)) store.undoStack.pop();
            store.commit([{ t: 'delete', id: n.id }], false);
            store.selection.clear();
        }
        this.ctx.store.changed();
    }

    onPointerDown(p: Point, e: PointerEvent) {
        const { store, viewport } = this.ctx, tol = 6 / viewport.zoom;
        store.begin();
        const n = this.path();
        if (n) {
            const abs = this.abs(n), closed = !!n.closed, last = abs.length - 1, target = this.pick(abs, closed, p, tol);
            if (this.drawing) {
                if (target?.kind === 'anchor' && target.index === 0 && last >= 1 && !closed) {
                    this.write(n, abs, true);
                    this.drawing = false;
                    this.sel = 0;
                    this.drag = { kind: 'handles', index: 0, start: p, abs, moved: false };
                    return;
                }
                if (target?.kind === 'anchor' && target.index === last) {
                    abs[last] = { ...abs[last], ox: abs[last].x, oy: abs[last].y };
                    this.write(n, abs);
                    this.drag = { kind: 'out', index: last, start: p, abs, moved: false, free: true };
                    return;
                }
                const q = e.shiftKey ? snap45(abs[last], p) : p;
                abs.push(corner(q.x, q.y));
                if (!this.write(n, abs)) return;
                this.sel = abs.length - 1;
                this.drag = { kind: 'handles', index: this.sel, start: q, abs, moved: false };
                return;
            }
            if (target) {
                const now = performance.now(), twice = target.kind === 'anchor' && this.lastDown.index === target.index && now - this.lastDown.time < 350;
                this.lastDown = { index: target.kind === 'anchor' && !twice ? target.index : -1, time: now };
                this.sel = target.index;
                if (twice) { this.toggle(n, abs, target.index); return; }
                this.drag = { ...target, start: p, abs, moved: false };
                return;
            }
            const near = nearest(abs, closed, p);
            if (near.d <= tol) {
                const next = split(abs, near.seg, near.t);
                if (!this.write(n, next)) return;
                this.sel = near.seg + 1;
                this.drag = { kind: 'anchor', index: this.sel, start: p, abs: next, moved: true };
                return;
            }
        }
        this.create(p);
    }
    create(p: Point) {
        const { store } = this.ctx, doc = store.doc, target = hit(doc, p);
        const parent = target?.type === 'frame' ? target : target?.parent ? doc.get(target.parent) : undefined;
        const origin = parent ? world(doc, parent) : { x: 0, y: 0 }, abs = [corner(p.x, p.y)], f = fit(abs, false, origin);
        const node: Node = { ...makeNode('path', f.x, f.y, between(children(doc, parent?.id ?? null).at(-1)?.index ?? null)), parent: parent?.id ?? null, w: f.w, h: f.h, points: f.points };
        store.commit([{ t: 'create', node }]);
        store.selection.clear();
        store.selection.add(node.id);
        this.drawing = true;
        this.sel = 0;
        this.drag = { kind: 'handles', index: 0, start: p, abs, moved: false };
        store.changed();
    }
    /** Double-click an anchor: smooth becomes corner, corner gets handles along its neighbours. */
    toggle(n: Node, abs: PathPoint[], i: number) {
        const a = abs[i];
        if (smooth(a)) abs[i] = corner(a.x, a.y);
        else {
            const len = abs.length, closed = !!n.closed;
            const prev = i > 0 ? abs[i - 1] : closed ? abs[len - 1] : undefined, next = i < len - 1 ? abs[i + 1] : closed ? abs[0] : undefined;
            const from = prev ?? a, to = next ?? a, dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy);
            if (!d) return;
            const k = Math.min(Math.hypot(a.x - from.x, a.y - from.y), Math.hypot(to.x - a.x, to.y - a.y)) / 3 / d || 0.15;
            abs[i] = { x: a.x, y: a.y, ix: a.x - dx * k, iy: a.y - dy * k, ox: a.x + dx * k, oy: a.y + dy * k };
        }
        this.write(n, abs);
    }
    onPointerMove(p: Point, e: PointerEvent) {
        this.hover = p;
        this.ctx.invalidate();
        const d = this.drag, n = this.path();
        if (!d || !n || !(e.buttons & 1)) return;
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 2 / this.ctx.viewport.zoom) return;
        d.moved = true;
        const abs = d.abs.map(a => ({ ...a })), a = abs[d.index];
        if (!a) return;
        if (d.kind === 'anchor') {
            let dx = p.x - d.start.x, dy = p.y - d.start.y;
            if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? dy = 0 : dx = 0;
            abs[d.index] = { x: a.x + dx, y: a.y + dy, ix: a.ix + dx, iy: a.iy + dy, ox: a.ox + dx, oy: a.oy + dy };
        } else {
            const q = e.shiftKey ? snap45(a, p) : p;
            const [hx, hy, ox, oy] = d.kind === 'in' ? ['ix', 'iy', 'ox', 'oy'] as const : ['ox', 'oy', 'ix', 'iy'] as const;
            a[hx] = q.x;
            a[hy] = q.y;
            if (d.kind === 'handles') {
                if (!e.altKey) { a.ix = 2 * a.x - q.x; a.iy = 2 * a.y - q.y; }
            } else if (!e.altKey && !d.free) {
                const o = d.abs[d.index], len = Math.hypot(o[ox] - o.x, o[oy] - o.y), dl = Math.hypot(q.x - a.x, q.y - a.y);
                if (len && dl) { a[ox] = a.x - (q.x - a.x) / dl * len; a[oy] = a.y - (q.y - a.y) / dl * len; }
            }
        }
        this.write(n, abs);
    }
    onPointerUp() {
        const d = this.drag, n = this.path();
        this.drag = undefined;
        if (d && n && !d.moved && d.kind === 'anchor' && !this.drawing && !n.closed && n.points!.length > 1 && (d.index === 0 || d.index === n.points!.length - 1)) {
            if (d.index === 0) this.write(n, reverse(this.abs(n)));
            this.drawing = true;
            this.sel = n.points!.length - 1;
        }
        this.ctx.store.end();
        this.ctx.store.changed();
    }
    onKey(e: KeyboardEvent) {
        const { store } = this.ctx, n = this.path();
        if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            if (this.drawing) this.finish();
            else this.exit();
            return true;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && n) {
            e.preventDefault();
            const abs = this.abs(n);
            if (this.sel < 0 || this.sel >= abs.length || abs.length <= 2) {
                store.commit([{ t: 'delete', id: n.id }]);
                store.selection.clear();
                this.drawing = false;
                this.sel = -1;
            } else {
                abs.splice(this.sel, 1);
                this.write(n, abs, !!n.closed && abs.length > 2);
                this.sel = Math.min(this.sel, abs.length - 1);
            }
            store.changed();
            return true;
        }
    }

    draw(c: CanvasRenderingContext2D, zoom: number) {
        const n = this.path();
        if (!n) return;
        const abs = this.abs(n), closed = !!n.closed, u = 1 / zoom;
        c.lineWidth = u;
        c.strokeStyle = ORANGE;
        c.beginPath();
        trace(c, abs, closed);
        c.stroke();
        const last = abs[abs.length - 1];
        if (this.drawing && this.hover && !this.drag && last) {
            c.setLineDash([4 * u, 3 * u]);
            c.beginPath();
            c.moveTo(last.x, last.y);
            c.bezierCurveTo(last.ox, last.oy, this.hover.x, this.hover.y, this.hover.x, this.hover.y);
            c.stroke();
            c.setLineDash([]);
            if (abs.length > 1 && Math.hypot(this.hover.x - abs[0].x, this.hover.y - abs[0].y) <= 6 * u) {
                c.beginPath();
                c.arc(abs[0].x, abs[0].y, 7 * u, 0, Math.PI * 2);
                c.stroke();
            }
        }
        abs.forEach((a, i) => {
            if (!this.shows(abs, closed, i)) return;
            for (const [x, y] of [[a.ix, a.iy], [a.ox, a.oy]]) {
                if (x === a.x && y === a.y) continue;
                c.beginPath();
                c.moveTo(a.x, a.y);
                c.lineTo(x, y);
                c.stroke();
                c.beginPath();
                c.arc(x, y, 3 * u, 0, Math.PI * 2);
                c.fillStyle = PAPER;
                c.fill();
                c.stroke();
            }
        });
        abs.forEach((a, i) => {
            const s = (i === this.sel ? 4 : 3) * u;
            c.fillStyle = i === this.sel ? ORANGE : PAPER;
            c.fillRect(a.x - s, a.y - s, s * 2, s * 2);
            c.strokeRect(a.x - s, a.y - s, s * 2, s * 2);
        });
    }
}
