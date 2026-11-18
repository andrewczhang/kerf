import { isOpenPath, strokeOptions, type Node } from './doc';
import { bounds, type Point, type Rect } from './geometry';
import type { PathPoint } from './path';

type Arrow = { kind: 'circle'; center: Point; radius: number } | { kind: 'fill' | 'line'; points: Point[] };

export function strokeStyle(n: Node) {
    const options = strokeOptions(n);
    const align = options.strokeAlign;
    const cap = options.strokeCap, join = options.strokeJoin, miter = options.strokeMiterLimit;
    const dash = options.strokeDash > 0 && options.strokeGap > 0 ? [options.strokeDash, options.strokeGap] : [];
    const width = n.strokeWidth * (align === 'center' ? 1 : 2);
    return { align, cap, join, miter, dash, width };
}

export function pathArrows(n: Node, points: PathPoint[]): Arrow[] {
    if (!isOpenPath(n) || !n.stroke || n.strokeWidth <= 0 || points.length < 2)
        return [];
    const { strokeStart, strokeEnd } = strokeOptions(n);
    const unit = Math.max(2, n.strokeWidth), arrows: Arrow[] = [];
    const add = (kind: typeof strokeStart, start: boolean) => {
        if (kind === 'none') return;
        const index = start ? 0 : points.length - 1, step = start ? 1 : -1;
        const tip = points[index];
        for (let i = index; points[i + step]; i += step) {
            const a = points[i], b = points[i + step];
            const controls = start ? [{ x: a.ox, y: a.oy }, { x: b.ix, y: b.iy }, b] : [{ x: a.ix, y: a.iy }, { x: b.ox, y: b.oy }, b];
            const control = controls.find(p => p.x !== tip.x || p.y !== tip.y);
            if (!control) continue;
            const dx = tip.x - control.x, dy = tip.y - control.y, length = Math.hypot(dx, dy);
            const x = dx / length * unit, y = dy / length * unit;
            const at = (back: number, side = 0) => ({ x: tip.x - back * x - side * y, y: tip.y - back * y + side * x });
            if (kind === 'circle') arrows.push({ kind, center: at(1.4), radius: 1.4 * unit });
            else if (kind === 'bar') arrows.push({ kind: 'line', points: [at(0, -1.6), at(0, 1.6)] });
            else arrows.push({ kind: kind === 'triangle' ? 'fill' : 'line', points: [at(3.5, -1.6), at(0), at(3.5, 1.6)] });
            return;
        }
    };
    add(strokeStart, true);
    add(strokeEnd, false);
    return arrows;
}

const expand = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });

export function strokeOutset(n: Node) {
    if (!n.stroke || n.strokeWidth <= 0)
        return 0;
    const { align, width } = strokeStyle(n);
    return align === 'inside' ? 0 : width / 2;
}

export function arrowBounds(n: Node, points: PathPoint[]): Rect[] {
    return pathArrows(n, points).map(arrow => {
        if (arrow.kind === 'circle')
            return expand({ ...arrow.center, w: 0, h: 0 }, arrow.radius);
        return expand(bounds(arrow.points.map(p => ({ ...p, w: 0, h: 0 }))), arrow.kind === 'line' ? n.strokeWidth / 2 : 0);
    });
}

export function hitMiter(n: Node, points: PathPoint[], p: Point) {
    const outset = strokeOutset(n), { join, miter } = strokeStyle(n);
    if (!outset || join !== 'miter' || points.length < 3) return false;
    const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
    const delta = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
    const tangent = (a: Point, controls: Point[]) => {
        const b = controls.find(b => b.x !== a.x || b.y !== a.y);
        if (!b) return;
        const d = delta(b, a), length = Math.hypot(d.x, d.y);
        return { x: d.x / length, y: d.y / length };
    };
    for (let i = n.closed ? 0 : 1; i < points.length - (n.closed ? 0 : 1); i++) {
        const v = points[i], prev = points[(i + points.length - 1) % points.length], next = points[(i + 1) % points.length];
        if (Math.abs(p.x - v.x) > outset * miter || Math.abs(p.y - v.y) > outset * miter) continue;
        const a = tangent(v, [{ x: v.ix, y: v.iy }, { x: prev.ox, y: prev.oy }, prev]);
        const b = tangent(v, [{ x: v.ox, y: v.oy }, { x: next.ix, y: next.iy }, next]);
        if (!a || !b) continue;
        const side = Math.sign(cross(b, a));
        if (!side) continue;
        const u = { x: -a.y * side, y: a.x * side }, w = { x: b.y * side, y: -b.x * side };
        const denominator = 1 + u.x * w.x + u.y * w.y;
        if (denominator <= 0 || Math.sqrt(2 / denominator) > miter) continue;
        const tip = { x: (u.x + w.x) / denominator, y: (u.y + w.y) / denominator };
        const q = { x: (p.x - v.x) / outset, y: (p.y - v.y) / outset };
        const signs = [[u, tip], [tip, w], [w, u]].map(([from, to]) => cross(delta(to, from), delta(q, from)));
        if (signs.every(s => s >= 0) || signs.every(s => s <= 0)) return true;
    }
    return false;
}

export function strokeBounds(n: Node, r: Rect, points: PathPoint[] = []): Rect {
    const outset = strokeOutset(n);
    if (!outset)
        return r;
    const { cap, join, dash, miter } = strokeStyle(n);
    const square = cap === 'square' && (isOpenPath(n) || dash.length > 0) ? Math.SQRT2 : 1;
    const corner = n.type === 'path' && join === 'miter' && (n.closed || points.length > 2) ? miter : 1;
    return bounds([expand(r, outset * Math.max(square, corner)), ...arrowBounds(n, points)]);
}
