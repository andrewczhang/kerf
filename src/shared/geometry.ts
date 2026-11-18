import { children, type Doc, type Node } from './doc';
import { hitPath, toAbs } from './path';
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
export function contains(r: Rect, p: Point) { return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h; }
export function intersects(a: Rect, b: Rect) { return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y; }
type SizeOf = (node: Node) => Pick<Rect, 'w' | 'h'>;
export function world(doc: Doc, n: Node, sizeOf: SizeOf = n => n): Rect { let x = n.x, y = n.y, p = n.parent; const seen = new Set([n.id]); while (p && !seen.has(p)) {
    seen.add(p);
    const a = doc.get(p);
    if (!a)
        break;
    x += a.x;
    y += a.y;
    p = a.parent;
} const { w, h } = sizeOf(n); return { x, y, w, h }; }
export function hit(doc: Doc, p: Point, parent: string | null = null, sizeOf?: SizeOf, tol = 4): Node | undefined { for (const n of children(doc, parent).reverse()) {
    const r = world(doc, n, sizeOf);
    if (n.type === 'path') {
        if (n.points && hitPath(toAbs(n.points, r), !!n.closed, p, Math.max(tol, n.strokeWidth / 2)))
            return n;
        continue;
    }
    if (!contains(r, p))
        continue;
    const child = hit(doc, p, n.id, sizeOf, tol);
    if (child)
        return child;
    if (n.type !== 'ellipse' || ((p.x - r.x - r.w / 2) / (r.w / 2)) ** 2 + ((p.y - r.y - r.h / 2) / (r.h / 2)) ** 2 <= 1)
        return n;
} }
export function bounds(rs: Rect[]): Rect { if (!rs.length)
    return { x: 0, y: 0, w: 0, h: 0 }; const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y)); return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y }; }
export function handles(r: Rect): Point[] { return [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]].map(([x, y]) => ({ x: r.x + r.w * x, y: r.y + r.h * y })); }
