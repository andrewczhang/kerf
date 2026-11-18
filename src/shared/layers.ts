import { applyOp, between, children, descendants, makeNode, maskEligible, type Doc, type Node, type Op } from './doc';
import { bounds, center, identity, inverse, localMatrix, matrixAngle, parentMatrix, transform, transformedBounds, worldMatrix, type Point, type SizeOf } from './geometry';

export function blocked(doc: Doc, n: Node, lock = true): boolean { return !!n.hidden || lock && !!n.locked || !!n.parent && !!doc.get(n.parent) && blocked(doc, doc.get(n.parent)!, lock); }
export function outerGroup(doc: Doc, n: Node): Node { let result = n, p = n.parent; while (p) { const a = doc.get(p); if (!a || a.type === 'frame') break; if (a.type === 'group') result = a; p = a.parent; } return result; }
function set(id: string, values: Partial<Node>): Op[] { return Object.entries(values).map(([key, value]) => ({ t: 'set', id, key, value } as Op)); }
function validParent(doc: Doc, id: string, parent: string | null) { return parent === null || !!doc.get(parent) && !doc.get(parent)!.instanceOf && ['frame', 'group', 'page'].includes(doc.get(parent)!.type) && parent !== id && !descendants(doc, id).some(n => n.id === parent); }
export function normalizeGroups(doc: Doc, sizeOf: SizeOf = n => n): Op[] {
    const shadow = new Map(doc), ops: Op[] = [];
    const visit = (n: Node) => { for (const c of children(shadow, n.id)) visit(c); if (n.type !== 'group') return; const cs = children(shadow, n.id); if (!cs.length) return;
        const b = bounds(cs.map(c => { const { w, h } = sizeOf(c); return transformedBounds(localMatrix(c, { w, h }), { x: 0, y: 0, w, h }); })), changes = [...set(n.id, { x: n.x + b.x, y: n.y + b.y, w: b.w, h: b.h }), ...cs.flatMap(c => set(c.id, { x: c.x - b.x, y: c.y - b.y }))];
        for (const op of changes) if (op.t === 'set' && shadow.get(op.id)?.[op.key] !== op.value) { ops.push(op); applyOp(shadow, op); }
    };
    for (const n of children(shadow, null)) visit(n);
    return ops;
}
function normalized(doc: Doc, ops: Op[], sizeOf?: SizeOf) { const shadow = new Map(doc); for (const op of ops) applyOp(shadow, op); return [...ops, ...normalizeGroups(shadow, sizeOf)]; }
function relocate(doc: Doc, shadow: Doc, n: Node, parent: string | null, sizeOf: SizeOf): Op[] {
    const p = parent ? worldMatrix(shadow, shadow.get(parent)!, sizeOf) : identity, c = transform(inverse(p), center(doc, n, sizeOf)), { w, h } = sizeOf(n);
    const ops = set(n.id, { parent, x: c.x - w / 2, y: c.y - h / 2, rotation: n.type === 'group' ? 0 : matrixAngle(worldMatrix(doc, n, sizeOf)) - matrixAngle(p) });
    for (const op of ops) applyOp(shadow, op);
    if (n.type === 'group') for (const child of children(doc, n.id)) ops.push(...relocate(doc, shadow, child, n.id, sizeOf));
    return ops;
}
export function rotateOps(doc: Doc, ids: string[], pivot: Point, angle: number, sizeOf: SizeOf = n => n): Op[] {
    if (!Number.isFinite(angle)) return [];
    const roots = ids.flatMap(id => { const n = doc.get(id); return n && !ids.some(a => a !== id && descendants(doc, a).some(c => c.id === id)) ? [n] : []; });
    if (!roots.length) return [];
    const nodes = (n: Node): Node[] => n.type === 'group' ? children(doc, n.id).flatMap(nodes) : [n];
    const a = angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const ops = roots.flatMap(nodes).flatMap(n => { const p = center(doc, n, sizeOf), { w, h } = sizeOf(n), dx = p.x - pivot.x, dy = p.y - pivot.y, local = transform(inverse(parentMatrix(doc, n, sizeOf)), { x: pivot.x + dx * c - dy * s, y: pivot.y + dx * s + dy * c }); return set(n.id, { x: local.x - w / 2, y: local.y - h / 2, rotation: (n.rotation ?? 0) + angle }); });
    const result = normalized(doc, ops, sizeOf), shadow = new Map(doc), affected = new Set(result.map(op => op.t === 'create' ? op.node.id : op.id));
    for (const op of result) applyOp(shadow, op);
    for (const n of roots.flatMap(nodes)) { let p = n.parent; while (p) { const a = doc.get(p); if (!a) break; if (a.type === 'group') { affected.add(a.id); for (const c of children(doc, a.id)) affected.add(c.id); } p = a.parent; } }
    return [...affected].flatMap(id => { const n = shadow.get(id)!; return set(id, { x: n.x, y: n.y, w: n.w, h: n.h, rotation: n.rotation ?? 0 }); });
}
export function moveOps(doc: Doc, id: string, parent: string | null, position: { beforeId?: string; afterId?: string } = {}, sizeOf: SizeOf = n => n): Op[] {
    const n = doc.get(id); if (!n || n.type === 'page' || !validParent(doc, id, parent)) return [];
    const siblings = children(doc, parent).filter(n => n.id !== id), target = position.beforeId ?? position.afterId;
    const i = siblings.findIndex(n => n.id === target); if (target && i < 0) return [];
    const slot = i < 0 ? siblings.length : position.beforeId ? i : i + 1;
    return normalized(doc, [...relocate(doc, new Map(doc), n, parent, sizeOf), ...set(id, { index: between(siblings[slot - 1]?.index ?? null, siblings[slot]?.index ?? null) })], sizeOf);
}
export function groupOps(doc: Doc, ids: string[], sizeOf: SizeOf = n => n): Op[] {
    const order: Node[] = []; const visit = (p: string | null) => { for (const n of children(doc, p)) { order.push(n); visit(n.id); } }; visit(null);
    const nodes = order.filter(n => n.type !== 'page' && ids.includes(n.id) && !ids.some(id => id !== n.id && descendants(doc, id).some(c => c.id === n.id)));
    const top = nodes.at(-1); if (!top) return [];
    const g = { ...makeNode('group', 0, 0, top.index), parent: top.parent }, shadow = new Map(doc); shadow.set(g.id, g);
    const ops: Op[] = [{ t: 'create', node: g }]; let index: string | null = null;
    for (const n of nodes) { index = between(index); ops.push(...relocate(doc, shadow, n, g.id, sizeOf), ...set(n.id, { index })); }
    return normalized(doc, ops, sizeOf);
}
export function ungroupOps(doc: Doc, id: string, sizeOf: SizeOf = n => n): Op[] {
    const g = doc.get(id); if (g?.type !== 'group') return [];
    const siblings = children(doc, g.parent), next = siblings[siblings.findIndex(n => n.id === id) + 1]?.index ?? null;
    let index = g.index; const ops: Op[] = [], shadow = new Map(doc);
    for (const n of children(doc, id)) { ops.push(...relocate(doc, shadow, n, g.parent, sizeOf), ...set(n.id, { index })); index = between(index, next); }
    ops.push({ t: 'delete', id }); return normalized(doc, ops, sizeOf);
}
export function maskOps(doc: Doc, ids: string[], sizeOf: SizeOf = n => n): Op[] {
    const unique = [...new Set(ids)];
    if (unique.length === 1) { const n = doc.get(unique[0]); return n && maskEligible(n) ? set(n.id, { mask: !n.mask }) : []; }
    const ops = groupOps(doc, unique, sizeOf), group = ops.find(op => op.t === 'create');
    if (!group || group.t !== 'create') return [];
    const shadow = new Map(doc); for (const op of ops) applyOp(shadow, op);
    const bottom = children(shadow, group.node.id)[0];
    return bottom && maskEligible(bottom) ? [...ops, ...set(bottom.id, { mask: true })] : [];
}
