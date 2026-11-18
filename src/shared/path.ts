import type { Point, Rect } from './geometry';

/** Anchor with in/out control points. Stored normalized to the node box; absolute while editing. A corner has handles equal to its anchor. */
export interface PathPoint { x: number; y: number; ix: number; iy: number; ox: number; oy: number }

export const MAX_POINTS = 500;
const KEYS = ['x', 'y', 'ix', 'iy', 'ox', 'oy'] as const;
const STEPS = 24;

export function corner(x: number, y: number): PathPoint { return { x, y, ix: x, iy: y, ox: x, oy: y }; }

export function validPoints(v: unknown): v is PathPoint[] {
    return Array.isArray(v) && v.length >= 1 && v.length <= MAX_POINTS && v.every(p => !!p && typeof p === 'object' && KEYS.every(k => Number.isFinite((p as Record<string, unknown>)[k])));
}

export function toAbs(points: PathPoint[], r: Rect): PathPoint[] {
    const X = (v: number) => r.x + v * r.w, Y = (v: number) => r.y + v * r.h;
    return points.map(p => ({ x: X(p.x), y: Y(p.y), ix: X(p.ix), iy: Y(p.iy), ox: X(p.ox), oy: Y(p.oy) }));
}

export function reverse(points: PathPoint[]): PathPoint[] { return [...points].reverse().map(p => ({ x: p.x, y: p.y, ix: p.ox, iy: p.oy, ox: p.ix, oy: p.iy })); }

export function smooth(p: PathPoint): boolean { return p.ix !== p.x || p.iy !== p.y || p.ox !== p.x || p.oy !== p.y; }

export function segments(points: PathPoint[], closed: boolean): [PathPoint, PathPoint][] {
    const out: [PathPoint, PathPoint][] = [];
    for (let i = 0; i < points.length - 1; i++) out.push([points[i], points[i + 1]]);
    if (closed && points.length > 1) out.push([points[points.length - 1], points[0]]);
    return out;
}

export function bezier(a: PathPoint, b: PathPoint, t: number): Point {
    const u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
    return { x: w0 * a.x + w1 * a.ox + w2 * b.ix + w3 * b.x, y: w0 * a.y + w1 * a.oy + w2 * b.iy + w3 * b.y };
}

export function flatten(points: PathPoint[], closed: boolean): Point[] {
    if (!points.length) return [];
    const out: Point[] = [{ x: points[0].x, y: points[0].y }];
    for (const [a, b] of segments(points, closed)) for (let i = 1; i <= STEPS; i++) out.push(bezier(a, b, i / STEPS));
    return out;
}

export function curveBounds(points: PathPoint[], closed: boolean): Rect {
    const pts = flatten(points, closed);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Absolute points -> parent-relative box plus points normalized to it. */
export function fit(abs: PathPoint[], closed: boolean, origin: Point, extra: PathPoint[][] = []) {
    const all = [flatten(abs, closed), ...extra.map(c => flatten(c, true))].flat(), xs = all.map(p => p.x), ys = all.map(p => p.y);
    const bx = Math.min(...xs), by = Math.min(...ys), w = Math.max(1, Math.max(...xs) - bx), h = Math.max(1, Math.max(...ys) - by);
    const X = (v: number) => round((v - bx) / w), Y = (v: number) => round((v - by) / h);
    const norm = (ps: PathPoint[]) => ps.map(p => ({ x: X(p.x), y: Y(p.y), ix: X(p.ix), iy: Y(p.iy), ox: X(p.ox), oy: Y(p.oy) }));
    return { x: round(bx - origin.x), y: round(by - origin.y), w: round(w), h: round(h), points: norm(abs), ...(extra.length ? { contours: extra.map(norm) } : {}) };
}

/** Every contour of a path node in world space: the editable points first, then compound contours. */
export function contoursAbs(n: { points?: PathPoint[]; contours?: PathPoint[][] }, r: Rect): PathPoint[][] {
    return [toAbs(n.points ?? [], r), ...(n.contours ?? []).map(c => toAbs(c, r))];
}

export interface PathSink { moveTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; closePath(): void }

export function trace(c: PathSink, abs: PathPoint[], closed: boolean) {
    if (!abs.length) return;
    c.moveTo(abs[0].x, abs[0].y);
    for (const [a, b] of segments(abs, closed)) c.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
    if (closed) c.closePath();
}

function segmentDistance(p: Point, a: Point, b: Point) {
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
    return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}

/** Closest point on the curve: segment index, parameter t and distance. */
export function nearest(abs: PathPoint[], closed: boolean, p: Point) {
    let best = { seg: -1, t: 0, d: Infinity };
    segments(abs, closed).forEach(([a, b], seg) => {
        let prev = bezier(a, b, 0);
        for (let i = 1; i <= STEPS * 2; i++) {
            const next = bezier(a, b, i / (STEPS * 2)), s = segmentDistance(p, prev, next);
            if (s.d < best.d) best = { seg, t: (i - 1 + s.t) / (STEPS * 2), d: s.d };
            prev = next;
        }
    });
    return best;
}

/** Insert an anchor at t on segment seg without changing the curve's shape (de Casteljau). */
export function split(abs: PathPoint[], seg: number, t: number): PathPoint[] {
    const out = abs.map(p => ({ ...p })), a = out[seg], b = out[(seg + 1) % out.length];
    const lerp = (p: Point, q: Point): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    if (a.ox === a.x && a.oy === a.y && b.ix === b.x && b.iy === b.y) {
        out.splice(seg + 1, 0, corner(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t));
        return out;
    }
    const p1 = { x: a.ox, y: a.oy }, p2 = { x: b.ix, y: b.iy };
    const q0 = lerp(a, p1), q1 = lerp(p1, p2), q2 = lerp(p2, b), r0 = lerp(q0, q1), r1 = lerp(q1, q2), s = lerp(r0, r1);
    a.ox = q0.x; a.oy = q0.y; b.ix = q2.x; b.iy = q2.y;
    out.splice(seg + 1, 0, { x: s.x, y: s.y, ix: r0.x, iy: r0.y, ox: r1.x, oy: r1.y });
    return out;
}

export function hitPath(abs: PathPoint[], closed: boolean, p: Point, tol: number, extra: PathPoint[][] = []): boolean {
    const polys = [flatten(abs, closed), ...extra.map(c => flatten(c, true))];
    if (polys.length === 1 && polys[0].length === 1) return Math.hypot(p.x - polys[0][0].x, p.y - polys[0][0].y) <= tol;
    for (const poly of polys) for (let i = 1; i < poly.length; i++) if (segmentDistance(p, poly[i - 1], poly[i]).d <= tol) return true;
    if (!closed) return false;
    let inside = false;
    for (const poly of polys) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

/** Snap p to the nearest 45° ray from a. */
export function snap45(a: Point, p: Point): Point {
    const dx = p.x - a.x, dy = p.y - a.y, angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(dx, dy) * Math.cos(Math.atan2(dy, dx) - angle);
    return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
}
