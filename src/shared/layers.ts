import { applyOp, between, children, descendants, makeNode, type Doc, type Node, type Op } from './doc';
import { bounds, world } from './geometry';

export function blocked(doc: Doc, n: Node, lock = true): boolean { return !!n.hidden || lock && !!n.locked || !!n.parent && !!doc.get(n.parent) && blocked(doc, doc.get(n.parent)!, lock); }
export function outerGroup(doc: Doc, n: Node): Node { let result = n, p = n.parent; while (p) { const a = doc.get(p); if (!a || a.type === 'frame') break; if (a.type === 'group') result = a; p = a.parent; } return result; }
function set(id: string, values: Partial<Node>): Op[] { return Object.entries(values).map(([key, value]) => ({ t: 'set', id, key, value } as Op)); }
function validParent(doc: Doc, id: string, parent: string | null) { return parent === null || !!doc.get(parent) && !doc.get(parent)!.instanceOf && ['frame', 'group'].includes(doc.get(parent)!.type) && parent !== id && !descendants(doc, id).some(n => n.id === parent); }
export function normalizeGroups(doc: Doc): Op[] {
    const shadow = new Map(doc), ops: Op[] = [];
    const visit = (n: Node) => { for (const c of children(shadow, n.id)) visit(c); if (n.type !== 'group') return; const cs = children(shadow, n.id); if (!cs.length) return;
        const b = bounds(cs), changes = [...set(n.id, { x: n.x + b.x, y: n.y + b.y, w: b.w, h: b.h }), ...cs.flatMap(c => set(c.id, { x: c.x - b.x, y: c.y - b.y }))];
        for (const op of changes) if (op.t === 'set' && shadow.get(op.id)?.[op.key] !== op.value) { ops.push(op); applyOp(shadow, op); }
    };
    for (const n of children(shadow, null)) visit(n);
    return ops;
}
function normalized(doc: Doc, ops: Op[]) { const shadow = new Map(doc); for (const op of ops) applyOp(shadow, op); return [...ops, ...normalizeGroups(shadow)]; }
export function moveOps(doc: Doc, id: string, parent: string | null, position: { beforeId?: string; afterId?: string } = {}): Op[] {
    const n = doc.get(id); if (!n || !validParent(doc, id, parent)) return [];
    const siblings = children(doc, parent).filter(n => n.id !== id), target = position.beforeId ?? position.afterId;
    const i = siblings.findIndex(n => n.id === target); if (target && i < 0) return [];
    const slot = i < 0 ? siblings.length : position.beforeId ? i : i + 1;
    const r = world(doc, n), p = parent ? world(doc, doc.get(parent)!) : { x: 0, y: 0 };
    return normalized(doc, set(id, { parent, x: r.x - p.x, y: r.y - p.y, index: between(siblings[slot - 1]?.index ?? null, siblings[slot]?.index ?? null) }));
}
export function groupOps(doc: Doc, ids: string[]): Op[] {
    const order: Node[] = []; const visit = (p: string | null) => { for (const n of children(doc, p)) { order.push(n); visit(n.id); } }; visit(null);
    const nodes = order.filter(n => ids.includes(n.id) && !ids.some(id => id !== n.id && descendants(doc, id).some(c => c.id === n.id)));
    const top = nodes.at(-1); if (!top) return [];
    const g = { ...makeNode('group', 0, 0, top.index), parent: top.parent }, p = g.parent ? world(doc, doc.get(g.parent)!) : { x: 0, y: 0 };
    const ops: Op[] = [{ t: 'create', node: g }]; let index: string | null = null;
    for (const n of nodes) { const r = world(doc, n); index = between(index); ops.push(...set(n.id, { parent: g.id, index, x: r.x - p.x, y: r.y - p.y })); }
    return normalized(doc, ops);
}
export function ungroupOps(doc: Doc, id: string): Op[] {
    const g = doc.get(id); if (g?.type !== 'group') return [];
    const siblings = children(doc, g.parent), next = siblings[siblings.findIndex(n => n.id === id) + 1]?.index ?? null;
    let index = g.index; const ops: Op[] = [];
    for (const n of children(doc, id)) { ops.push(...set(n.id, { parent: g.parent, x: n.x + g.x, y: n.y + g.y, index })); index = between(index, next); }
    ops.push({ t: 'delete', id }); return normalized(doc, ops);
}
