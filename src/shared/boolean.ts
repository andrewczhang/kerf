import type { Point } from './geometry';

/** A region is a set of closed polygons filled even-odd. */
export type Polygon = Point[];
export type Region = Polygon[];
export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'exclude';

interface V { x: number; y: number; next: V; prev: V; inter: boolean; entry: boolean; visited: boolean; alpha: number; neighbor?: V }

function ring(poly: Polygon): V {
    let first: V | undefined, last: V | undefined;
    for (const p of poly) {
        const v = { x: p.x, y: p.y, inter: false, entry: false, visited: false, alpha: 0 } as V;
        if (!first) first = v.next = v.prev = v;
        else { v.prev = last!; v.next = first; last!.next = v; first.prev = v; }
        last = v;
    }
    return first!;
}

const each = (start: V, f: (v: V) => void) => { let v = start; do { const n = v.next; f(v); v = n; } while (v !== start); };
const nextReal = (v: V) => { while (v.inter) v = v.next; return v; };

export function inside(region: Region, p: Point): boolean {
    let r = false;
    for (const poly of region) for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i], b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) r = !r;
    }
    return r;
}

export function area(poly: Polygon) {
    let s = 0;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
    return s / 2;
}

/** Signed area of a region under even-odd fill, assuming its contours do not cross. */
export function regionArea(region: Region) {
    return region.reduce((s, poly) => s + (inside(region.filter(q => q !== poly), probe(poly)) ? -1 : 1) * Math.abs(area(poly)), 0);
}

/** A point just inside poly next to its first edge, away from vertices other contours may touch. */
function probe(poly: Polygon): Point {
    const a = poly[0], b = poly[1], l = Math.hypot(b.x - a.x, b.y - a.y) || 1, s = -Math.sign(area(poly)) * Math.min(1e-3, l / 4);
    return { x: (a.x + b.x) / 2 - (b.y - a.y) / l * s, y: (a.y + b.y) / 2 + (b.x - a.x) / l * s };
}

function insert(v: V, start: V, end: V) {
    let at = start.next;
    while (at !== end && at.alpha < v.alpha) at = at.next;
    v.next = at; v.prev = at.prev; at.prev.next = v; at.prev = v;
}

let steps = 0;

/**
 * Shift b by a tiny offset (about 1e-7 of the scene) that is different on every call, so none of b's vertices or edges
 * coincide with a's, including edges a inherited from earlier shifted operands: the degenerate cases Greiner-Hormann cannot handle.
 */
function prepare(a: Region, b: Region): [Region, Region] {
    const all = [...a, ...b].flat(), g = Math.max(1, ...all.map(p => Math.abs(p.x)), ...all.map(p => Math.abs(p.y))) * 1e-7;
    const hash = (v: number) => { const h = Math.sin(v) * 43758.5453; return 0.2 + 0.8 * (h - Math.floor(h)); };
    const k = ++steps, dx = g * hash(k * 12.9898), dy = g * hash(k * 78.233);
    return [a, b.map(poly => poly.map(p => ({ x: p.x + dx, y: p.y + dy })))];
}

/** Greiner-Hormann clipping on even-odd regions. Operands come from prepare. */
function clip(a: Region, b: Region, op: 'union' | 'subtract' | 'intersect'): Region {
    a = a.filter(p => p.length > 2); b = b.filter(p => p.length > 2);
    const ra = a.map(ring), rb = b.map(ring);
    for (const sa of ra) each(sa, va => { if (va.inter) return; const wa = nextReal(va.next);
        for (const sb of rb) each(sb, vb => { if (vb.inter) return; const wb = nextReal(vb.next);
            const d = (wb.y - vb.y) * (wa.x - va.x) - (wb.x - vb.x) * (wa.y - va.y);
            if (!d) return;
            const ta = ((wb.x - vb.x) * (va.y - vb.y) - (wb.y - vb.y) * (va.x - vb.x)) / d, tb = ((wa.x - va.x) * (va.y - vb.y) - (wa.y - va.y) * (va.x - vb.x)) / d;
            if (ta <= 0 || ta >= 1 || tb <= 0 || tb >= 1) return;
            const x = va.x + ta * (wa.x - va.x), y = va.y + ta * (wa.y - va.y);
            const ia = { x, y, inter: true, entry: false, visited: false, alpha: ta } as V, ib = { x, y, inter: true, entry: false, visited: false, alpha: tb } as V;
            ia.neighbor = ib; ib.neighbor = ia;
            insert(ia, va, wa); insert(ib, vb, wb);
        });
    });
    const mark = (rings: V[], other: Region, flip: boolean) => rings.forEach(s => {
        let status = inside(other, s);
        each(s, v => { if (v.inter) { v.entry = status === flip; status = !status; } });
    });
    mark(ra, b, op !== 'intersect');
    mark(rb, a, op === 'union');
    const out: Region = [];
    for (const s of ra) each(s, v => {
        if (!v.inter || v.visited) return;
        const poly: Polygon = [];
        let cur = v;
        do {
            cur.visited = true; cur.neighbor!.visited = true;
            const fwd = cur.entry;
            poly.push({ x: cur.x, y: cur.y });
            do { cur = fwd ? cur.next : cur.prev; if (!cur.inter) poly.push({ x: cur.x, y: cur.y }); } while (!cur.inter);
            cur = cur.neighbor!;
        } while (!cur.visited);
        out.push(poly);
    });
    const crossed = (s: V) => { let c = false; each(s, v => { c ||= v.inter; }); return c; };
    a.forEach((poly, i) => { if (!crossed(ra[i]) && inside(b, poly[0]) === (op === 'intersect')) out.push(poly); });
    b.forEach((poly, i) => { if (!crossed(rb[i]) && inside(a, poly[0]) === (op !== 'union')) out.push(poly); });
    return out;
}

const perimeter = (poly: Polygon) => poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + Math.hypot(q.x - p.x, q.y - p.y); }, 0);

/** Snap to a tol/10 grid, collapsing the hairline gaps shifted coincident edges leave, then cut the spikes that leaves. */
function despike(poly: Polygon, tol: number): Polygon {
    const q = tol / 10, pts = poly.map(p => ({ x: Math.round(p.x / q) * q, y: Math.round(p.y / q) * q }));
    for (let changed = true; changed && pts.length > 2;) {
        changed = false;
        for (let i = 0; i < pts.length && pts.length > 2; i++) {
            const a = pts[(i + pts.length - 1) % pts.length], p = pts[i], b = pts[(i + 1) % pts.length];
            const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
            if ((!ux && !uy) || (Math.abs(ux * vy - uy * vx) <= 1e-9 * (Math.hypot(ux, uy) * Math.hypot(vx, vy) + 1) && ux * vx + uy * vy < 0)) { pts.splice(i--, 1); changed = true; }
        }
    }
    return pts;
}

/**
 * Merge contours that share edges (pieces that touch once snapped): orient every contour by its even-odd depth,
 * split edges where any vertex (including the contour's own, for self-touching contours) lies on them, cancel each edge against its reverse, and relink the rest.
 */
function merge(region: Region, tol: number): Region {
    if (!region.length) return region;
    const q = tol / 10, key = (p: Point) => `${p.x},${p.y}`;
    const oriented = region.map(poly => {
        const depth = region.filter(o => o !== poly && inside([o], probe(poly))).length;
        return (area(poly) < 0) === (depth % 2 === 0) ? poly : [...poly].reverse();
    });
    const boxes = oriented.map(poly => { const xs = poly.map(p => p.x), ys = poly.map(p => p.y); return { x0: Math.min(...xs) - q, y0: Math.min(...ys) - q, x1: Math.max(...xs) + q, y1: Math.max(...ys) + q }; });
    const near = boxes.map((m, i) => oriented.filter((_, j) => boxes[j].x0 <= m.x1 && m.x0 <= boxes[j].x1 && boxes[j].y0 <= m.y1 && m.y0 <= boxes[j].y1).flat());
    const edges: [Point, Point][] = [];
    oriented.forEach((poly, k) => poly.forEach((a, i) => {
        const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
        const x0 = Math.min(a.x, b.x) - q, x1 = Math.max(a.x, b.x) + q, y0 = Math.min(a.y, b.y) - q, y1 = Math.max(a.y, b.y) + q;
        const on: { v: Point; t: number }[] = [];
        for (const v of near[k]) {
            if (v.x < x0 || v.x > x1 || v.y < y0 || v.y > y1) continue;
            const t = ((v.x - a.x) * dx + (v.y - a.y) * dy) / l2;
            if (t > 1e-9 && t < 1 - 1e-9 && Math.abs((v.x - a.x) * dy - (v.y - a.y) * dx) / l < q / 2) on.push({ v, t });
        }
        [a, ...on.sort((m, n) => m.t - n.t).map(o => o.v), b].forEach((p, j, ps) => { if (j && key(ps[j - 1]) !== key(p)) edges.push([ps[j - 1], p]); });
    }));
    const count = new Map<string, number>();
    for (const [a, b] of edges) count.set(key(a) + '>' + key(b), (count.get(key(a) + '>' + key(b)) ?? 0) + 1);
    const out = new Map<string, [Point, Point][]>();
    for (const e of edges) {
        const fwd = key(e[0]) + '>' + key(e[1]), back = key(e[1]) + '>' + key(e[0]);
        if (count.get(back)) { count.set(back, count.get(back)! - 1); count.set(fwd, count.get(fwd)! - 1); continue; }
        if (!count.get(fwd)) continue;
        count.set(fwd, count.get(fwd)! - 1);
        (out.get(key(e[0])) ?? out.set(key(e[0]), []).get(key(e[0]))!).push(e);
    }
    const loops: Region = [];
    for (const list of out.values()) while (list.length) {
        const loop: Polygon = [];
        let e = list.pop()!;
        const start = key(e[0]);
        for (let guard = 0; e && guard < edges.length; guard++) {
            loop.push(e[0]);
            if (key(e[1]) === start) break;
            const next = out.get(key(e[1]));
            if (!next?.length) break;
            e = next.pop()!;
        }
        if (loop.length > 2) loops.push(loop);
    }
    return loops;
}

/** Simplify contours and drop the hairline slivers that shifted coincident edges leave behind. */
function clean(region: Region, tol: number): Region {
    return (tol > 0 ? merge(region.map(poly => despike(poly, tol)).filter(p => p.length > 2), tol) : region).map(poly => simplify(poly, tol)).filter(p => p.length > 2 && Math.abs(area(p)) > tol * tol && 2 * Math.abs(area(p)) / perimeter(p) > tol / 10);
}

/** Drop near-duplicate and near-collinear vertices (Ramer-Douglas-Peucker on a closed ring). */
export function simplify(poly: Polygon, tol: number): Polygon {
    const pts = poly.filter((p, i) => { const q = poly[(i + poly.length - 1) % poly.length]; return Math.hypot(p.x - q.x, p.y - q.y) > tol / 10; });
    if (pts.length < 4) return pts;
    const dist = (p: Point, a: Point, b: Point) => { const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy); return l ? Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / l : Math.hypot(p.x - a.x, p.y - a.y); };
    let far = 0;
    pts.forEach((p, i) => { if (Math.hypot(p.x - pts[0].x, p.y - pts[0].y) > Math.hypot(pts[far].x - pts[0].x, pts[far].y - pts[0].y)) far = i; });
    const rdp = (s: Point[]): Point[] => {
        let idx = 0, max = 0;
        for (let i = 1; i < s.length - 1; i++) { const d = dist(s[i], s[0], s[s.length - 1]); if (d > max) { max = d; idx = i; } }
        return max > tol ? [...rdp(s.slice(0, idx + 1)).slice(0, -1), ...rdp(s.slice(idx))] : [s[0], s[s.length - 1]];
    };
    const half1 = rdp(pts.slice(0, far + 1)), half2 = rdp([...pts.slice(far), pts[0]]);
    return [...half1.slice(0, -1), ...half2.slice(0, -1)];
}

/** Combine regions bottom to top: subtract removes every upper region from the bottom one. */
export function combine(regions: Region[], op: BooleanOp, tol = 0.05): Region {
    if (!regions.length) return [];
    if (op === 'subtract') return clean(clip(...prepare(regions[0], combine(regions.slice(1), 'union', tol)), 'subtract'), tol);
    return regions.slice(1).reduce((acc, r) => {
        const [a, b] = prepare(acc, r);
        if (op !== 'exclude') return clean(clip(a, b, op), tol);
        const left = clean(clip(a, b, 'subtract'), tol), right = clean(clip(b, a, 'subtract'), tol);
        return !left.length ? right : !right.length ? left : clean(clip(...prepare(left, right), 'union'), tol);
    }, clean(regions[0], tol));
}
