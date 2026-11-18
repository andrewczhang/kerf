import { isOpenPath, strokeOptions, type Node } from '../shared/doc';
import { bounds, type Point, type Rect } from '../shared/geometry';
import type { PathPoint } from '../shared/path';

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

export function strokeBounds(n: Node, r: Rect, points: PathPoint[] = []): Rect {
    if (!n.stroke || n.strokeWidth <= 0)
        return r;
    const { align, cap, join, width, dash, miter } = strokeStyle(n);
    const square = cap === 'square' && (isOpenPath(n) || dash.length > 0) ? Math.SQRT2 : 1;
    const corner = n.type === 'path' && join === 'miter' && (n.closed || points.length > 2) ? miter : 1;
    const pad = align === 'inside' ? 0 : width / 2 * Math.max(square, corner);
    return bounds([expand(r, pad), ...pathArrows(n, points).map(arrow => {
        if (arrow.kind === 'circle')
            return expand({ ...arrow.center, w: 0, h: 0 }, arrow.radius);
        return expand(bounds(arrow.points.map(p => ({ ...p, w: 0, h: 0 }))), arrow.kind === 'line' ? n.strokeWidth / 2 : 0);
    })]);
}
