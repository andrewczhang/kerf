import { between, children, makeNode, type Node } from '../../shared/doc';
import type { Point } from '../../shared/geometry';
import { hit, world } from '../geometry';
import type { Context, Tool } from './tool';
export class Shape implements Tool {
    cursor = 'crosshair';
    start?: Point;
    id: string;
    node?: Node;
    constructor(public ctx: Context, public type: Node['type'], public done: () => void) { this.id = type; }
    onPointerDown(p: Point) { this.start = p; this.ctx.store.begin(); const target = hit(this.ctx.store.doc, p); const parent = target?.type === 'frame' ? target : target?.parent ? this.ctx.store.doc.get(target.parent) : undefined; const origin = parent ? world(this.ctx.store.doc, parent) : { x: 0, y: 0 }; this.node = makeNode(this.type, p.x - origin.x, p.y - origin.y, between(children(this.ctx.store.doc, parent?.id ?? null).at(-1)?.index ?? null)); this.node.parent = parent?.id ?? null; this.ctx.store.commit([{ t: 'create', node: this.node }]); this.ctx.store.selection.clear(); this.ctx.store.selection.add(this.node.id); }
    onPointerMove(p: Point, e: PointerEvent) { if (!this.start || !this.node)
        return; let w = Math.abs(p.x - this.start.x), h = Math.abs(p.y - this.start.y); if (e.shiftKey)
        w = h = Math.max(w, h); const origin = this.node.parent ? world(this.ctx.store.doc, this.ctx.store.doc.get(this.node.parent)!) : { x: 0, y: 0 }; this.ctx.store.set(this.node.id, { x: (p.x < this.start.x ? this.start.x - w : this.start.x) - origin.x, y: (p.y < this.start.y ? this.start.y - h : this.start.y) - origin.y, w: Math.max(1, w), h: Math.max(1, h) }); }
    onPointerUp() { this.ctx.store.end(); this.start = undefined; this.node = undefined; this.done(); }
}
