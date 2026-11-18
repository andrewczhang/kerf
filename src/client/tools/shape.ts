import { between, children, makeNode, type Node } from '../../shared/doc';
import { inverse, matrixAngle, parentMatrix, transform, type Point } from '../../shared/geometry';
import { hit, worldMatrix } from '../geometry';
import { expand, isVirtual, splitVirtual } from '../../shared/components';
import type { Context, Tool } from './tool';
import { snapped, clearSnap, roundUnlessSnapped } from '../snapping';
export class Shape implements Tool {
    cursor = 'crosshair';
    start?: Point;
    downAt?: Point;
    id: string;
    node?: Node;
    constructor(public ctx: Context, public type: Node['type'], public done: () => void) { this.id = type; }
    onPointerDown(p: Point) {
        this.ctx.store.begin(); const doc = expand(this.ctx.store.doc), inner = hit(doc, p), target = inner && isVirtual(inner.id) ? doc.get(splitVirtual(inner.id).instance) : inner, frame = target?.type === 'frame' ? target : target?.parent ? doc.get(target.parent) : undefined, parent = frame?.instanceOf ? undefined : frame;
        const local = parent ? transform(inverse(worldMatrix(doc, parent)), p) : p;
        this.downAt = local; this.start = { x: Math.round(local.x), y: Math.round(local.y) };
        this.node = { ...makeNode(this.type, this.start.x, this.start.y, between(children(doc, parent?.id ?? null).at(-1)?.index ?? null)), parent: parent?.id ?? null };
        this.ctx.store.selection.clear(); this.ctx.store.selection.add(this.node.id); this.ctx.store.commit([{ t: 'create', node: this.node }]);
    }
    onPointerMove(p: Point, e: PointerEvent) {
        if (e.buttons === 0 || !this.start || !this.node || !this.ctx.store.doc.has(this.node.id)) return;
        const m = parentMatrix(this.ctx.store.doc, this.node), raw = transform(inverse(m), p), q = { x: Math.round(raw.x), y: Math.round(raw.y) };
        let w = Math.abs(q.x - this.start.x), h = Math.abs(q.y - this.start.y);
        if (e.shiftKey) w = h = Math.max(w, h);
        const left = q.x === this.start.x ? raw.x < this.downAt!.x : q.x < this.start.x, top = q.y === this.start.y ? raw.y < this.downAt!.y : q.y < this.start.y;
        let r = { x: left ? this.start.x - w : this.start.x, y: top ? this.start.y - h : this.start.y, w: Math.max(1, w), h: Math.max(1, h) };
        if (Math.abs(matrixAngle(m)) < 1e-8) { const adjusted = snapped(this.ctx, { ...r, x: r.x + m[4], y: r.y + m[5] }, e, { x: left ? 0 : 1, y: top ? 0 : 1 }); r = { ...adjusted, x: adjusted.x - m[4], y: adjusted.y - m[5] }; }
        this.ctx.store.set(this.node.id, { x: roundUnlessSnapped(this.ctx, r.x), y: roundUnlessSnapped(this.ctx, r.y), w: Math.max(1, roundUnlessSnapped(this.ctx, r.w)), h: Math.max(1, roundUnlessSnapped(this.ctx, r.h)) });
    }
    cancelGesture() { if (!this.start) return; clearSnap(this.ctx); this.ctx.store.end(); this.start = undefined; this.downAt = undefined; this.node = undefined; }
    onPointerUp() { if (!this.start) return; this.cancelGesture(); this.done(); }
}
