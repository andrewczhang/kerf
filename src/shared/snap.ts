import type { Rect } from './geometry';
export interface Guide { axis: 'x' | 'y'; position: number; start: number; end: number }
export interface RulerGuide { axis: 'x' | 'y'; position: number }
export interface Distance { x1: number; y1: number; x2: number; y2: number; value: number }
export interface Edges { x?: 0 | 1; y?: 0 | 1 }
export function snapRect(r: Rect, targets: Rect[], threshold: number, grid = false, lines: RulerGuide[] = [], edges?: Edges) {
    const guides: Guide[] = [];
    const correction = (axis: 'x' | 'y') => {
        if (edges && edges[axis] === undefined) return 0;
        const size = axis === 'x' ? 'w' : 'h', cross = axis === 'x' ? 'y' : 'x', span = axis === 'x' ? 'h' : 'w';
        const anchors = edges ? [r[axis] + r[size] * edges[axis]!] : [r[axis], r[axis] + r[size] / 2, r[axis] + r[size]];
        const candidates = targets.flatMap(t => [0, .5, 1].map(k => ({ position: t[axis] + t[size] * k, start: t[cross], end: t[cross] + t[span] })));
        candidates.push(...lines.filter(l => l.axis === axis).map(l => ({ position: l.position, start: r[cross], end: r[cross] + r[span] })));
        let delta: number | undefined;
        for (const a of anchors) for (const t of candidates) {
            const d = t.position - a;
            if (Math.abs(d) <= threshold && (delta === undefined || Math.abs(d) < Math.abs(delta))) delta = d;
        }
        const d = delta ?? ((grid ? Math.round(anchors[0] / 8) * 8 : Math.round(anchors[0])) - anchors[0]);
        if (delta !== undefined) for (const t of candidates) if (anchors.some(a => Math.abs(a + d - t.position) < 1e-6))
            guides.push({ axis, position: t.position, start: Math.min(r[cross], t.start), end: Math.max(r[cross] + r[span], t.end) });
        return Math.round(anchors[0] + d) - anchors[0];
    };
    const dx = correction('x'), dy = correction('y');
    for (const g of guides) {
        const start = g.axis === 'x' ? r.y + dy : r.x + dx;
        g.start = Math.min(g.start, start); g.end = Math.max(g.end, start + (g.axis === 'x' ? r.h : r.w));
    }
    return { dx, dy, guides };
}
export function resizeSnap(r: Rect, targets: Rect[], threshold: number, edges: Edges, grid = false, lines: RulerGuide[] = [], constraints: { center?: boolean; aspect?: boolean } = {}) {
    const s = snapRect(r, targets, threshold, grid, lines, edges);
    const factor = constraints.center ? 2 : 1;
    let w = Math.max(1, r.w + (edges.x === 0 ? -s.dx : edges.x === 1 ? s.dx : 0) * factor);
    let h = Math.max(1, r.h + (edges.y === 0 ? -s.dy : edges.y === 1 ? s.dy : 0) * factor);
    if (constraints.aspect) {
        const scale = Math.abs(w / r.w - 1) >= Math.abs(h / r.h - 1) ? w / r.w : h / r.h;
        w = r.w * scale; h = r.h * scale;
    }
    const rect = { x: r.x + (constraints.center ? (r.w - w) / 2 : edges.x === 0 ? r.w - w : 0), y: r.y + (constraints.center ? (r.h - h) / 2 : edges.y === 0 ? r.h - h : 0), w, h };
    const guides = s.guides.filter(g => Math.abs(rect[g.axis] + rect[g.axis === 'x' ? 'w' : 'h'] * edges[g.axis]! - g.position) < 1e-6);
    return { rect, guides };
}
export function distancesTo(r: Rect, t: Rect): Distance[] {
    const out: Distance[] = [];
    const horizontal = (a: number, b: number, y: number) => out.push({ x1: a, y1: y, x2: b, y2: y, value: Math.abs(b - a) });
    const vertical = (a: number, b: number, x: number) => out.push({ x1: x, y1: a, x2: x, y2: b, value: Math.abs(b - a) });
    const x = r.x + r.w / 2, y = r.y + r.h / 2;
    if (r.x >= t.x && r.y >= t.y && r.x + r.w <= t.x + t.w && r.y + r.h <= t.y + t.h) {
        horizontal(t.x, r.x, y); horizontal(r.x + r.w, t.x + t.w, y);
        vertical(t.y, r.y, x); vertical(r.y + r.h, t.y + t.h, x);
    } else {
        if (r.x + r.w <= t.x) horizontal(r.x + r.w, t.x, y);
        else if (t.x + t.w <= r.x) horizontal(t.x + t.w, r.x, y);
        if (r.y + r.h <= t.y) vertical(r.y + r.h, t.y, x);
        else if (t.y + t.h <= r.y) vertical(t.y + t.h, r.y, x);
    }
    return out;
}
export function nearestDistances(r: Rect, targets: Rect[]): Distance[] {
    const nearest = new Map<string, Distance>();
    for (const t of targets) for (const d of distancesTo(r, t)) {
        const horizontal = d.y1 === d.y2;
        if (horizontal ? t.y > r.y + r.h || t.y + t.h < r.y : t.x > r.x + r.w || t.x + t.w < r.x) continue;
        const key = horizontal ? (d.x2 <= r.x ? 'left' : 'right') : (d.y2 <= r.y ? 'top' : 'bottom');
        if (!nearest.has(key) || nearest.get(key)!.value > d.value) nearest.set(key, d);
    }
    return [...nearest.values()];
}
