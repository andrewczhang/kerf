import type { Store } from './store';
import { worldMatrix } from './geometry';
import { identity, inverse, transform, type Mat } from '../shared/geometry';
import { between, children, makeNode, type Doc, type Node, type Op } from '../shared/doc';
import { combine, simplify, type BooleanOp, type Polygon, type Region } from '../shared/boolean';
import { MAX_POINTS, contoursAbs, corner, fit, flatten } from '../shared/path';

export const booleanOps: [BooleanOp, string, string][] = [['union', 'Union', 'U'], ['subtract', 'Subtract', 'S'], ['intersect', 'Intersect', 'I'], ['exclude', 'Exclude', 'X']];

const shape = (n: Node | undefined): n is Node => !!n && (n.type === 'rect' || n.type === 'ellipse' || (n.type === 'path' && !!n.closed));

function order(doc: Doc, parent: string | null = null, out: Node[] = []) {
    for (const n of children(doc, parent)) { out.push(n); order(doc, n.id, out); }
    return out;
}

/** The shape's outline in the coordinate space `toHome` maps world points into. */
function region(doc: Doc, n: Node, toHome: Mat): Region {
    const m = worldMatrix(doc, n);
    return localRegion(n).map(poly => poly.map(p => transform(toHome, transform(m, p))));
}

function localRegion(n: Node): Region {
    const r = { x: 0, y: 0, w: n.w, h: n.h };
    if (n.type === 'path') return contoursAbs(n, r).map(c => flatten(c, true).slice(0, -1));
    const arc = (cx: number, cy: number, rx: number, ry: number, from: number, steps: number): Polygon =>
        Array.from({ length: steps + 1 }, (_, i) => { const a = from + (i / steps) * Math.PI / 2; return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry }; });
    if (n.type === 'ellipse') {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        return [Array.from({ length: 96 }, (_, i) => ({ x: cx + Math.cos(i / 96 * Math.PI * 2) * r.w / 2, y: cy + Math.sin(i / 96 * Math.PI * 2) * r.h / 2 }))];
    }
    const k = Math.min(n.radius, r.w / 2, r.h / 2);
    if (k <= 0) return [[{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]];
    return [[...arc(r.x + r.w - k, r.y + k, k, k, -Math.PI / 2, 12), ...arc(r.x + r.w - k, r.y + r.h - k, k, k, 0, 12), ...arc(r.x + k, r.y + r.h - k, k, k, Math.PI / 2, 12), ...arc(r.x + k, r.y + k, k, k, Math.PI, 12)]];
}

export const canCombine = (store: Store) => [...store.selection].filter(id => shape(store.doc.get(id))).length > 1;

/** Replace the selected shapes with one path that is their boolean combination, as a single undo step. */
export function applyBoolean(store: Store, op: BooleanOp) {
    const nodes = order(store.doc).filter(n => store.selection.has(n.id) && shape(n));
    if (nodes.length < 2) return false;
    const chain = (n: Node) => { const ids: (string | null)[] = []; for (let p = n.parent; p; p = store.doc.get(p)?.parent ?? null) ids.push(p); return [...ids, null]; };
    const home = chain(nodes[0]).find(id => nodes.every(n => chain(n).includes(id))) ?? null, parent = home ? store.doc.get(home) : undefined;
    const result = combine(nodes.map(n => region(store.doc, n, parent ? inverse(worldMatrix(store.doc, parent)) : identity)), op).slice(0, 200).map(poly => {
        for (let tol = 0.05; poly.length > MAX_POINTS; tol *= 2) poly = simplify(poly, tol);
        return poly.map(p => corner(p.x, p.y));
    });
    if (!result.length) return false;
    const under = (n: Node) => { while (n.parent !== home) n = store.doc.get(n.parent!)!; return n; };
    const bottom = nodes[0], top = nodes.map(under).reduce((m, n) => n.index > m.index ? n : m);
    const next = children(store.doc, home).find(n => n.index > top.index && !store.selection.has(n.id));
    const f = fit(result[0], true, { x: 0, y: 0 }, result.slice(1));
    const node: Node = { ...makeNode('path', f.x, f.y, between(top.index, next?.index ?? null)), parent: home, name: booleanOps.find(o => o[0] === op)![1], w: f.w, h: f.h,
        points: f.points, ...(f.contours ? { contours: f.contours } : {}), closed: true, fill: bottom.fill, stroke: bottom.stroke, strokeWidth: bottom.strokeWidth, opacity: bottom.opacity,
        ...(bottom.fills ? { fills: structuredClone(bottom.fills) } : {}), ...(bottom.effects ? { effects: structuredClone(bottom.effects) } : {}) };
    store.commit([...nodes.map(n => ({ t: 'delete', id: n.id }) as Op), { t: 'create', node }]);
    store.selection.clear();
    store.selection.add(node.id);
    store.changed();
    return true;
}
