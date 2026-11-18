import { children, type Doc, type Node } from './doc';
import { containsPath, hitPath, toAbs } from './path';
import { arrowBounds, hitMiter, strokeBounds, strokeOutset, strokeStyle } from './stroke';
export interface Point {
    x: number;
    y: number;
}
export interface Rect extends Point {
    w: number;
    h: number;
}
export type Mat = [
    number,
    number,
    number,
    number,
    number,
    number
];
export function transform(m: Mat, p: Point): Point { return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }; }
export const identity: Mat = [1, 0, 0, 1, 0, 0];
export function multiply(a: Mat, b: Mat): Mat { return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]]; }
export function inverse(m: Mat): Mat { const d = m[0] * m[3] - m[1] * m[2]; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; }
export function localMatrix(n: Node, size: Pick<Rect, 'w' | 'h'> = n): Mat { const a = (n.type === 'group' ? 0 : n.rotation ?? 0) * Math.PI / 180, c = Math.abs(Math.cos(a)) < 1e-12 ? 0 : Math.cos(a), s = Math.abs(Math.sin(a)) < 1e-12 ? 0 : Math.sin(a), x = size.w / 2, y = size.h / 2; return [c, s, -s, c, n.x + x - c * x + s * y, n.y + y - s * x - c * y]; }
export function worldMatrix(doc: Doc, n: Node, sizeOf: SizeOf = n => n): Mat { const chain: Node[] = [], seen = new Set<string>(); let node: Node | undefined = n; while (node && !seen.has(node.id)) { chain.unshift(node); seen.add(node.id); node = node.parent ? doc.get(node.parent) : undefined; } return chain.reduce((m, node) => multiply(m, localMatrix(node, sizeOf(node))), identity); }
export function parentMatrix(doc: Doc, n: Node, sizeOf?: SizeOf): Mat { const p = n.parent ? doc.get(n.parent) : undefined; return p ? worldMatrix(doc, p, sizeOf) : identity; }
export function matrixAngle(m: Mat): number { return Math.atan2(m[1], m[0]) * 180 / Math.PI; }
export function center(doc: Doc, n: Node, sizeOf: SizeOf = n => n): Point { const { w, h } = sizeOf(n); return transform(worldMatrix(doc, n, sizeOf), { x: w / 2, y: h / 2 }); }
export function corners(r: Rect): Point[] { return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }]; }
export function transformedBounds(m: Mat, r: Rect): Rect { return bounds(corners(r).map(p => ({ ...transform(m, p), w: 0, h: 0 }))); }
export function worldCorners(doc: Doc, n: Node, sizeOf: SizeOf = n => n): Point[] { const { w, h } = sizeOf(n), m = worldMatrix(doc, n, sizeOf); return corners({ x: 0, y: 0, w, h }).map(p => transform(m, p)); }
export function aabb(doc: Doc, n: Node, sizeOf: SizeOf = n => n): Rect { return bounds(worldCorners(doc, n, sizeOf).map(p => ({ ...p, w: 0, h: 0 }))); }
export function nodeHandles(doc: Doc, n: Node, sizeOf: SizeOf = n => n): Point[] { const { w, h } = sizeOf(n), m = worldMatrix(doc, n, sizeOf); return handles({ x: 0, y: 0, w, h }).map(p => transform(m, p)); }
export function contains(r: Rect, p: Point) { return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h; }
export function activeMask(doc: Doc, n: Node): Node | undefined { if (n.mask && !n.hidden) return; let mask: Node | undefined; for (const sibling of children(doc, n.parent)) { if (sibling.id === n.id) break; if (sibling.mask && !sibling.hidden) mask = sibling; } return mask; }
export function ancestorMasks(doc: Doc, n: Node): Node[] { const masks: Node[] = [], seen = new Set<string>(); let current: Node | undefined = n; while (current && !seen.has(current.id)) { seen.add(current.id); const mask = activeMask(doc, current); if (mask) masks.push(mask); current = current.parent ? doc.get(current.parent) : undefined; } return masks; }
export function maskContains(doc: Doc, n: Node, p: Point, sizeOf?: SizeOf): boolean {
    const { w, h } = sizeOf ? sizeOf(n) : n, r = { x: 0, y: 0, w, h };
    p = transform(inverse(worldMatrix(doc, n, sizeOf)), p);
    if (n.type === 'path') return containsPath(toAbs(n.points ?? [], r), p);
    if (n.type === 'ellipse') return ((p.x - r.x - r.w / 2) / (r.w / 2)) ** 2 + ((p.y - r.y - r.h / 2) / (r.h / 2)) ** 2 <= 1;
    if (!contains(r, p)) return false;
    const radius = Math.min(n.radius, r.w / 2, r.h / 2);
    const x = Math.max(r.x + radius, Math.min(p.x, r.x + r.w - radius)), y = Math.max(r.y + radius, Math.min(p.y, r.y + r.h - radius));
    return (p.x - x) ** 2 + (p.y - y) ** 2 <= radius ** 2;
}
export function intersects(a: Rect, b: Rect) { return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y; }
export type SizeOf = (node: Node) => Pick<Rect, 'w' | 'h'>;
export function world(doc: Doc, n: Node, sizeOf: SizeOf = n => n): Rect { let x = n.x, y = n.y, p = n.parent; const seen = new Set([n.id]); while (p && !seen.has(p)) {
    seen.add(p);
    const a = doc.get(p);
    if (!a)
        break;
    x += a.x;
    y += a.y;
    p = a.parent;
} const { w, h } = sizeOf(n); return { x, y, w, h }; }
function hitsEllipse(r: Rect, p: Point, outset: number) {
    const a = r.w / 2, b = r.h / 2, x = Math.abs(p.x - r.x - a), y = Math.abs(p.y - r.y - b);
    if (Math.hypot(x / a, y / b) <= 1) return true;
    if (!outset || x > a + outset || y > b + outset) return false;
    // Solve for the closest point on the ellipse before adding the stroke's constant-width outset.
    let low = 0, high = Math.hypot(a * x, b * y);
    for (let i = 0; i < 24; i++) {
        const t = (low + high) / 2;
        if (Math.hypot(x / (a + t / a), y / (b + t / b)) > 1) low = t;
        else high = t;
    }
    return Math.hypot(x * high / (a * a + high), y * high / (b * b + high)) <= outset;
}
export function hit(doc: Doc, p: Point, parent: string | null = null, sizeOf?: SizeOf, tol = 4): Node | undefined {
    for (const n of children(doc, parent).reverse()) {
        if (n.hidden || n.locked) continue;
        if (ancestorMasks(doc, n).some(mask => !maskContains(doc, mask, p, sizeOf))) continue;
        if (n.mask) { if (maskContains(doc, n, p, sizeOf)) return n; continue; }
        const { w, h } = sizeOf ? sizeOf(n) : n, r = { x: 0, y: 0, w, h }, local = transform(inverse(worldMatrix(doc, n, sizeOf)), p);
        if (n.type === 'path') {
            const points = toAbs(n.points ?? [], r), outset = strokeOutset(n);
            const capPad = strokeStyle(n).cap === 'square' ? Math.SQRT2 : 1;
            if (hitPath(points, !!n.closed, local, Math.max(tol, n.strokeWidth / 2, outset * capPad))
                || arrowBounds(n, points).some(b => contains(b, local)) || hitMiter(n, points, local))
                return n;
            continue;
        }
        const inside = contains(r, local);
        if (inside || n.type === 'group') {
            const child = hit(doc, p, n.id, sizeOf, tol);
            if (child) return child;
        }
        if (n.type === 'ellipse' ? hitsEllipse(r, local, strokeOutset(n))
            : inside || (n.type === 'rect' || n.type === 'frame') && contains(strokeBounds(n, r), local))
            return n;
    }
}
export function bounds(rs: Rect[]): Rect { if (!rs.length)
    return { x: 0, y: 0, w: 0, h: 0 }; const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y)); return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y }; }
export function handles(r: Rect): Point[] { return [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]].map(([x, y]) => ({ x: r.x + r.w * x, y: r.y + r.h * y })); }
