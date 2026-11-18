import type { Rect } from './geometry';
export interface Guide { axis: 'x' | 'y'; position: number; start: number; end: number }
export interface RulerGuide { axis: 'x' | 'y'; position: number }
export interface Distance { x1: number; y1: number; x2: number; y2: number; value: number }
export interface Edges { x?: 0 | 1; y?: 0 | 1 }
function spacingCandidates(r: Rect, targets: Rect[], axis: 'x' | 'y') {
    const size = axis === 'x' ? 'w' : 'h', cross = axis === 'x' ? 'y' : 'x', span = axis === 'x' ? 'h' : 'w';
    const row = targets.filter(t => Math.min(t[cross] + t[span], r[cross] + r[span]) > Math.max(t[cross], r[cross]) && !(t[axis] <= r[axis] && t[axis] + t[size] >= r[axis] + r[size])).sort((a, b) => a[axis] - b[axis]);
    const left = row.filter(t => t[axis] + t[size] <= r[axis]).sort((a, b) => a[axis] + a[size] - b[axis] - b[size]);
    const right = row.filter(t => t[axis] >= r[axis] + r[size]);
    const out: { delta: number; segments: Distance[] }[] = [];
    const add = (a: Rect, b: Rect, position: number, between: boolean) => {
        const low = Math.max(r[cross], a[cross], b[cross]), high = Math.min(r[cross] + r[span], a[cross] + a[span], b[cross] + b[span]);
        if (low >= high || b[axis] < a[axis] + a[size]) return;
        const moved = { ...r, [axis]: position };
        const ordered = [a, b, moved].sort((u, v) => u[axis] - v[axis]);
        if (ordered.some((t, i) => i > 0 && t[axis] < ordered[i - 1][axis] + ordered[i - 1][size])) return;
        if (row.some(t => t !== a && t !== b && t[axis] < ordered[2][axis] + ordered[2][size] && t[axis] + t[size] > ordered[0][axis])) return;
        const segments = ordered.slice(0, 2).map((t, i) => {
            const start = t[axis] + t[size], end = ordered[i + 1][axis], middle = (low + high) / 2;
            return axis === 'x' ? { x1: start, y1: middle, x2: end, y2: middle, value: end - start } : { x1: middle, y1: start, x2: middle, y2: end, value: end - start };
        });
        if (between || Math.abs(segments[0].value - segments[1].value) < 1e-6) out.push({ delta: position - r[axis], segments });
    };
    const a = left.at(-1), b = right[0];
    if (a && b) add(a, b, (a[axis] + a[size] + b[axis] - r[size]) / 2, true);
    if (a && left.length > 1) { const previous = left[left.length - 2], gap = a[axis] - previous[axis] - previous[size]; add(previous, a, a[axis] + a[size] + gap, false); }
    if (b && right.length > 1) { const next = right[1], gap = next[axis] - b[axis] - b[size]; add(b, next, b[axis] - gap - r[size], false); }
    return out;
}
export function snapRect(r: Rect, targets: Rect[], threshold: number, grid = false, lines: RulerGuide[] = [], edges?: Edges) {
    const guides: Guide[] = [];
    const spacing: Distance[] = [];
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
        let equal: ReturnType<typeof spacingCandidates>[number] | undefined;
        if (!edges) for (const candidate of spacingCandidates(r, targets, axis)) {
            if (Math.abs(candidate.delta) <= threshold && (delta === undefined || Math.abs(candidate.delta) < Math.abs(delta))) { delta = candidate.delta; equal = candidate; }
        }
        const d = delta ?? ((grid ? Math.round(anchors[0] / 8) * 8 : Math.round(anchors[0])) - anchors[0]);
        if (equal) spacing.push(...equal.segments);
        if (delta !== undefined && !equal) for (const t of candidates) if (anchors.some(a => Math.abs(a + d - t.position) < 1e-6))
            guides.push({ axis, position: t.position, start: Math.min(r[cross], t.start), end: Math.max(r[cross] + r[span], t.end) });
        return delta !== undefined ? d : Math.round(anchors[0] + d) - anchors[0];
    };
    const dx = correction('x'), dy = correction('y');
    for (const g of guides) {
        const start = g.axis === 'x' ? r.y + dy : r.x + dx;
        g.start = Math.min(g.start, start); g.end = Math.max(g.end, start + (g.axis === 'x' ? r.h : r.w));
    }
    return { dx, dy, guides, spacing };
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
