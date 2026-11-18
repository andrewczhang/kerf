import type { Point } from './doc';

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
    return region.reduce((s, poly) => s + (inside(region.filter(q => q !== poly), poly[0]) ? -1 : 1) * Math.abs(area(poly)), 0);
}

function insert(v: V, start: V, end: V) {
    let at = start.next;
    while (at !== end && at.alpha < v.alpha) at = at.next;
    v.next = at; v.prev = at.prev; at.prev.next = v; at.prev = v;
}

/** Greiner-Hormann clipping on even-odd regions. Degenerate overlaps are avoided by nudging b off a's vertices and edges. */
function clip(a: Region, b: Region, op: 'union' | 'subtract' | 'intersect'): Region {
    a = a.filter(p => p.length > 2); b = b.filter(p => p.length > 2);
    const all = [...a, ...b].flat(), size = Math.max(1, ...all.map(p => Math.abs(p.x)), ...all.map(p => Math.abs(p.y)));
    const e = size * 1e-7;
    b = b.map(poly => poly.map(p => ({ x: p.x + e * 0.7548776662, y: p.y + e * 0.5698402910 })));
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

function clean(region: Region, tol: number): Region {
    return region.map(poly => simplify(poly, tol)).filter(p => p.length > 2 && Math.abs(area(p)) > tol * tol);
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
    if (op === 'subtract') return clean(clip(regions[0], combine(regions.slice(1), 'union', tol), 'subtract'), tol);
    return clean(regions.slice(1).reduce((acc, r) => op === 'exclude'
        ? [...clip(acc, r, 'subtract'), ...clip(r, acc, 'subtract')]
        : clip(acc, r, op), regions[0]), tol);
}
