import { between, children, makeNode, type Node } from '../../shared/doc';
import { inverse, matrixAngle, parentMatrix, transform, type Point } from '../../shared/geometry';
import { hit, worldMatrix } from '../geometry';
import type { Context, Tool } from './tool';
import { snapped, clearSnap } from '../snapping';
export class Shape implements Tool {
    cursor = 'crosshair';
    start?: Point;
    id: string;
    node?: Node;
    constructor(public ctx: Context, public type: Node['type'], public done: () => void) { this.id = type; }
    onPointerDown(p: Point) {
        this.ctx.store.begin(); const doc = this.ctx.store.doc, target = hit(doc, p), parent = target?.type === 'frame' ? target : target?.parent ? doc.get(target.parent) : undefined;
        const local = parent ? transform(inverse(worldMatrix(doc, parent)), p) : p;
        this.start = local;
        this.node = { ...makeNode(this.type, local.x, local.y, between(children(doc, parent?.id ?? null).at(-1)?.index ?? null)), parent: parent?.id ?? null };
        this.ctx.store.selection.clear(); this.ctx.store.selection.add(this.node.id); this.ctx.store.commit([{ t: 'create', node: this.node }]);
    }
    onPointerMove(p: Point, e: PointerEvent) {
        if (e.buttons === 0 || !this.start || !this.node) return;
        const m = parentMatrix(this.ctx.store.doc, this.node), q = transform(inverse(m), p);
        let w = Math.abs(q.x - this.start.x), h = Math.abs(q.y - this.start.y);
        if (e.shiftKey) w = h = Math.max(w, h);
        let r = { x: q.x < this.start.x ? this.start.x - w : this.start.x, y: q.y < this.start.y ? this.start.y - h : this.start.y, w: Math.max(1, w), h: Math.max(1, h) };
        if (Math.abs(matrixAngle(m)) < 1e-8) { const adjusted = snapped(this.ctx, { ...r, x: r.x + m[4], y: r.y + m[5] }, e, { x: q.x < this.start.x ? 0 : 1, y: q.y < this.start.y ? 0 : 1 }); r = { ...adjusted, x: adjusted.x - m[4], y: adjusted.y - m[5] }; }
        this.ctx.store.set(this.node.id, r);
    }
    onPointerUp() { clearSnap(this.ctx); this.ctx.store.end(); this.start = undefined; this.node = undefined; this.done(); }
}
