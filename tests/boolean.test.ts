import { describe, expect, it } from 'vitest';
import { combine, inside, regionArea, type Region } from '../src/shared/boolean';

const sq = (x: number, y: number, s: number): Region => [[{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }]];
const a = sq(0, 0, 10), b = sq(5, 5, 10);
const close = (v: number, want: number) => expect(Math.abs(v - want)).toBeLessThan(0.01);

describe('boolean ops', () => {
    it('combines overlapping squares', () => {
        close(Math.abs(regionArea(combine([a, b], 'union'))), 175);
        close(Math.abs(regionArea(combine([a, b], 'intersect'))), 25);
        close(Math.abs(regionArea(combine([a, b], 'subtract'))), 75);
        close(Math.abs(regionArea(combine([a, b], 'exclude'))), 150);
        expect(combine([a, b], 'union')).toHaveLength(1);
        expect(combine([a, b], 'intersect')[0]).toHaveLength(4);
    });
    it('handles disjoint and contained shapes', () => {
        const far = sq(20, 0, 5), inner = sq(2, 2, 4);
        expect(combine([a, far], 'union')).toHaveLength(2);
        expect(combine([a, far], 'intersect')).toHaveLength(0);
        const ring = combine([a, inner], 'subtract');
        expect(ring).toHaveLength(2);
        close(regionArea(ring), 84);
        close(Math.abs(regionArea(combine([a, inner], 'intersect'))), 16);
        close(Math.abs(regionArea(combine([a, inner], 'union'))), 100);
    });
    it('copes with shared edges', () => {
        const right = sq(10, 0, 10);
        close(Math.abs(regionArea(combine([a, right], 'union'))), 200);
        close(Math.abs(regionArea(combine([a, sq(0, 0, 10)], 'intersect'))), 100);
        close(Math.abs(regionArea(combine([a, sq(0, 5, 10)], 'subtract'))), 50);
    });
    it('folds more than two shapes', () => {
        close(Math.abs(regionArea(combine([a, sq(8, 0, 10), sq(16, 0, 10)], 'union'))), 260);
        close(Math.abs(regionArea(combine([sq(0, 0, 30), sq(2, 2, 5), sq(20, 20, 5)], 'subtract'))), 850);
    });
});

describe('boolean ops on repeated and aligned edges', () => {
    const r = (x: number, y: number, w: number, h: number): Region => [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]];
    it('folds aligned rectangles', () => {
        close(Math.abs(regionArea(combine([r(0, 0, 10, 10), r(5, 0, 10, 10), r(10, 0, 10, 10)], 'union'))), 200);
        close(Math.abs(regionArea(combine([r(0, 0, 10, 10), r(0, 0, 20, 10), r(5, 0, 20, 10)], 'union'))), 250);
        close(Math.abs(regionArea(combine([r(0, 0, 10, 10), r(0, 0, 20, 10), r(0, 0, 10, 20)], 'intersect'))), 100);
        close(Math.abs(regionArea(combine([r(0, 0, 20, 10), r(5, 0, 10, 10), r(5, 0, 10, 5)], 'intersect'))), 50);
    });
    it('excludes repeated shapes', () => {
        const A = r(0, 0, 10, 10), B = r(5, 5, 10, 10);
        close(Math.abs(regionArea(combine([A, B, A], 'exclude'))), 100);
        close(Math.abs(regionArea(combine([A, A, B], 'exclude'))), 100);
        close(Math.abs(regionArea(combine([A, r(10, 0, 10, 10), r(5, 0, 10, 10)], 'exclude'))), 100);
        close(Math.abs(regionArea(combine([r(0, 0, 20, 10), r(10, 0, 20, 10), r(5, 0, 20, 10)], 'exclude'))), 200);
        close(Math.abs(regionArea(combine([r(0, 0, 20, 20), r(5, 5, 10, 10), r(5, 0, 10, 20)], 'exclude'))), 300);
        close(Math.abs(regionArea(combine([r(0, 0, 30, 30), r(5, 0, 20, 20), r(10, 0, 10, 10)], 'exclude'))), 600);
    });
});

describe('boolean ops match a grid count for random aligned rectangles', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    it('agrees for 1000 random folds of 10px cells', () => {
        for (let run = 0; run < 1000; run++) {
            const rects = Array.from({ length: 2 + rand(3) }, () => { const x = rand(8), y = rand(8); return { x, y, w: 1 + rand(8 - x), h: 1 + rand(8 - y) }; });
            const regions: Region[] = rects.map(({ x, y, w, h }) => [[{ x: x * 10, y: y * 10 }, { x: (x + w) * 10, y: y * 10 }, { x: (x + w) * 10, y: (y + h) * 10 }, { x: x * 10, y: (y + h) * 10 }]]);
            const count = (keep: (hits: boolean[]) => boolean) => { let n = 0;
                for (let x = 0; x < 9; x++) for (let y = 0; y < 9; y++) if (keep(rects.map(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h))) n++;
                return n; };
            const want = { union: count(h => h.some(Boolean)), intersect: count(h => h.every(Boolean)), subtract: count(h => h[0] && !h.slice(1).some(Boolean)), exclude: count(h => h.filter(Boolean).length % 2 === 1) };
            for (const op of ['union', 'intersect', 'subtract', 'exclude'] as const) {
                const got = Math.abs(regionArea(combine(regions, op))) / 100;
                expect(Math.abs(got - want[op]), `${op} ${JSON.stringify(rects)}`).toBeLessThan(0.01);
            }
        }
    });
});

describe('boolean ops match point sampling for random rects and ellipses', () => {
    let seed = 11;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const shape = (): Region => { const x = rand(6) * 10, y = rand(6) * 10, w = (1 + rand(5)) * 10, h = (1 + rand(5)) * 10;
        if (rand(2)) return [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]];
        return [Array.from({ length: 48 }, (_, i) => ({ x: x + w / 2 + Math.cos(i / 48 * Math.PI * 2) * w / 2, y: y + h / 2 + Math.sin(i / 48 * Math.PI * 2) * h / 2 }))]; };
    const dist = (p: { x: number; y: number }, r: Region) => Math.min(...r.flatMap(poly => poly.map((a, i) => { const b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))); return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy); })));
    it('agrees for 150 random folds', () => {
        for (let run = 0; run < 150; run++) {
            const regions = Array.from({ length: 2 + rand(3) }, shape);
            for (const op of ['union', 'intersect', 'subtract', 'exclude'] as const) {
                const got = combine(regions, op);
                for (let x = 1; x < 110; x += 4.3) for (let y = 1; y < 110; y += 4.3) {
                    const p = { x, y };
                    if (regions.some(r => dist(p, r) < 0.5)) continue;
                    const h = regions.map(r => inside(r, p));
                    const want = op === 'union' ? h.some(Boolean) : op === 'intersect' ? h.every(Boolean) : op === 'subtract' ? h[0] && !h.slice(1).some(Boolean) : h.filter(Boolean).length % 2 === 1;
                    expect(inside(got, p), `${op} run ${run} at ${x},${y}`).toBe(want);
                }
            }
        }
    }, 60000);
});
