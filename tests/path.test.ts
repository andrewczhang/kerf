import { describe, it, expect } from 'vitest';
import { applyOp, makeNode, type Doc } from '../src/shared/doc';
import { hit } from '../src/shared/geometry';
import { bezier, corner, curveBounds, fit, hitPath, nearest, reverse, snap45, split, toAbs, type PathPoint } from '../src/shared/path';

const square = [corner(0, 0), corner(100, 0), corner(100, 100), corner(0, 100)];
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-3);

describe('path geometry', () => {
    it('fits absolute points to a parent-relative box and back', () => {
        const abs = square.map(p => ({ ...p, x: p.x + 50, ix: p.ix + 50, ox: p.ox + 50 }));
        const f = fit(abs, true, { x: 20, y: 0 });
        expect([f.x, f.y, f.w, f.h]).toEqual([30, 0, 100, 100]);
        toAbs(f.points, { x: 50, y: 0, w: f.w, h: f.h }).forEach((p, i) => { close(p.x, abs[i].x); close(p.y, abs[i].y); });
    });
    it('keeps a straight line valid with a 1px minimum box', () => {
        const f = fit([corner(0, 10), corner(80, 10)], false, { x: 0, y: 0 });
        expect(f.h).toBe(1);
        expect(f.w).toBe(80);
    });
    it('bounds the curve, not its control points', () => {
        const a: PathPoint = { ...corner(0, 0), ox: 0, oy: -100 }, b: PathPoint = { ...corner(100, 0), ix: 100, iy: -100 };
        const r = curveBounds([a, b], false);
        close(r.y, -75);
        close(r.h, 75);
    });
    it('splits a segment without changing its shape', () => {
        const a: PathPoint = { ...corner(0, 0), ox: 30, oy: -60 }, b: PathPoint = { ...corner(100, 0), ix: 70, iy: 60 };
        const out = split([a, b], 0, 0.3);
        expect(out).toHaveLength(3);
        const m = bezier(a, b, 0.3);
        close(out[1].x, m.x);
        close(out[1].y, m.y);
        const q = bezier(out[1], out[2], 0.5), r = bezier(a, b, 0.65);
        close(q.x, r.x);
        close(q.y, r.y);
    });
    it('splits a straight segment with a corner point', () => {
        const out = split([corner(0, 0), corner(100, 0)], 0, 0.25);
        expect(out[1]).toEqual(corner(25, 0));
        expect(out[0]).toEqual(corner(0, 0));
    });
    it('finds the nearest segment and parameter', () => {
        const n = nearest(square, true, { x: 50, y: 103 });
        expect(n.seg).toBe(2);
        close(n.t, 0.5);
        close(n.d, 3);
    });
    it('hits strokes of open paths and interiors of closed paths', () => {
        expect(hitPath(square, false, { x: 50, y: 50 }, 4)).toBe(false);
        expect(hitPath(square, true, { x: 50, y: 50 }, 4)).toBe(true);
        expect(hitPath(square, false, { x: 50, y: 2 }, 4)).toBe(true);
        expect(hitPath(square, true, { x: 150, y: 50 }, 4)).toBe(false);
    });
    it('reverses direction and swaps handles', () => {
        const a: PathPoint = { ...corner(0, 0), ox: 10, oy: 0 }, b: PathPoint = { ...corner(50, 0), ix: 40, iy: 5 };
        const [rb, ra] = reverse([a, b]);
        expect(rb).toEqual({ x: 50, y: 0, ix: 50, iy: 0, ox: 40, oy: 5 });
        expect(ra.ix).toBe(10);
    });
    it('snaps to 45 degree rays', () => {
        const p = snap45({ x: 0, y: 0 }, { x: 100, y: 8 });
        close(p.y, 0);
        const d = snap45({ x: 0, y: 0 }, { x: 50, y: 54 });
        close(d.x, d.y);
    });
});

describe('path nodes', () => {
    it('validates points and the closed flag', () => {
        const doc: Doc = new Map(), n = makeNode('path', 0, 0);
        applyOp(doc, { t: 'create', node: { ...n, points: [] } });
        applyOp(doc, { t: 'create', node: { ...n, points: [{ x: 0, y: 0 }] as unknown as PathPoint[] } });
        expect(doc.size).toBe(0);
        applyOp(doc, { t: 'create', node: n });
        applyOp(doc, { t: 'set', id: n.id, key: 'points', value: [{ ...corner(0, 0), x: NaN }] });
        applyOp(doc, { t: 'set', id: n.id, key: 'closed', value: 'yes' });
        expect(doc.get(n.id)).toEqual(n);
        applyOp(doc, { t: 'set', id: n.id, key: 'points', value: [corner(0, 0), corner(1, 1)] });
        applyOp(doc, { t: 'set', id: n.id, key: 'closed', value: true });
        expect(doc.get(n.id)?.points).toHaveLength(2);
        expect(doc.get(n.id)?.closed).toBe(true);
    });
    it('hit-tests along the stroke, scaled with the node box', () => {
        const n = { ...makeNode('path', 10, 10), w: 200, h: 1, points: [corner(0, 0), corner(1, 0)] }, doc: Doc = new Map([[n.id, n]]);
        expect(hit(doc, { x: 110, y: 12 })?.id).toBe(n.id);
        expect(hit(doc, { x: 110, y: 30 })).toBeUndefined();
    });
});
