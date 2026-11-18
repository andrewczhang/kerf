import { it, expect } from 'vitest';
import { snapRect, resizeSnap, nearestDistances, distancesTo } from '../src/shared/snap';
const r = { x: 1, y: 2, w: 20, h: 20 };
it('snaps both axes and includes every aligned target', () => {
    const s = snapRect(r, [{ x: 24, y: 25, w: 20, h: 20 }, { x: 24, y: 80, w: 20, h: 20 }], 4);
    expect([s.dx, s.dy]).toEqual([3, 3]); expect(s.guides.filter(g => g.axis === 'x')).toHaveLength(2);
});
it('rounds pixels, falls back to grid, and prioritizes objects', () => {
    expect(snapRect({ ...r, x: 1.2 }, [], 6).dx).toBeCloseTo(-.2);
    expect(snapRect(r, [], 6, true).dx).toBe(-1);
    expect(snapRect(r, [{ ...r, x: 4 }], 6, true).dx).toBe(3);
    expect(snapRect(r, [], 6, false, [{ axis: 'x', position: 23 }]).dx).toBe(2);
});
it('resizes only moving edges and rejects out of threshold targets', () => {
    expect(resizeSnap(r, [{ ...r, x: 24 }], 4, { x: 1 }).rect).toEqual({ ...r, w: 23 });
    expect(snapRect(r, [{ ...r, x: 200, y: 200 }], 4).guides).toEqual([]);
});
it('preserves centered and proportional resize constraints', () => {
    const s = resizeSnap(r, [], 6, { x: 1 }, false, [{ axis: 'x', position: 24 }], { center: true, aspect: true });
    expect(s.rect).toEqual({ x: -2, y: -1, w: 26, h: 26 });
    expect(s.guides).toHaveLength(1);
});
it('handles negative coordinates and disabled axes', () => {
    expect(snapRect({ ...r, x: -5 }, [], -1, true).dx).toBe(-3);
    expect(resizeSnap(r, [{ ...r, y: 4 }], 6, { x: 1 }).rect.y).toBe(2);
});
it('measures nearest overlapping neighbors and container inner edges', () => {
    expect(nearestDistances(r, [])).toEqual([]);
    expect(nearestDistances(r, [{ ...r, x: 31 }, { ...r, x: 51 }, { ...r, x: 24, y: 100 }]).map(d => d.value)).toEqual([10]);
    expect(distancesTo(r, { x: 0, y: 0, w: 100, h: 100 }).map(d => d.value)).toEqual([1, 79, 2, 78]);
    expect(nearestDistances(r, [{ x: 0, y: 0, w: 100, h: 100 }]).map(d => d.value)).toEqual([1, 79, 2, 78]);
});
it('equalizes horizontal and vertical gaps between neighbors', () => {
    const s = snapRect({ x: 42, y: 0, w: 20, h: 20 }, [{ x: 0, y: 0, w: 20, h: 20 }, { x: 100, y: 0, w: 20, h: 20 }], 10);
    expect(s.dx).toBe(8); expect(s.spacing.map(d => d.value)).toEqual([30, 30]);
    expect(snapRect({ x: 42, y: 0, w: 20, h: 20 }, [{ x: -100, y: -100, w: 400, h: 400 }, { x: 0, y: 0, w: 20, h: 20 }, { x: 100, y: 0, w: 20, h: 20 }], 10).spacing.map(d => d.value)).toEqual([30, 30]);
    const v = snapRect({ x: 0, y: 42, w: 20, h: 20 }, [{ x: 0, y: 0, w: 20, h: 20 }, { x: 0, y: 100, w: 20, h: 20 }], 10);
    expect(v.dy).toBe(8); expect(v.spacing.map(d => d.value)).toEqual([30, 30]);
});
it('extends a sequence on either end and along either axis', () => {
    const row = [{ x: 0, y: 0, w: 20, h: 20 }, { x: 50, y: 0, w: 20, h: 20 }];
    expect(snapRect({ ...row[0], x: 103 }, row, 6).dx).toBe(-3);
    expect(snapRect({ ...row[0], x: -47 }, row, 6).dx).toBe(-3);
    const column = row.map(t => ({ ...t, x: t.y, y: t.x }));
    expect(snapRect({ ...row[0], y: 103 }, column, 6).spacing.map(d => d.value)).toEqual([30, 30]);
    expect(snapRect({ ...row[0], y: -47 }, column, 6).dy).toBe(-3);
});
it('competes with alignment by distance and ignores spacing for resize', () => {
    const moving = { x: 42, y: 0, w: 20, h: 20 }, row = [{ ...moving, x: 0 }, { ...moving, x: 100 }];
    const s = snapRect(moving, row, 10, false, [{ axis: 'x', position: 45 }]);
    expect(s.dx).toBe(3); expect(s.spacing).toEqual([]);
    expect(snapRect(moving, row, 10, false, [], { x: 1 }).spacing).toEqual([]);
    expect(snapRect(moving, row, 6).spacing).toEqual([]);
});
it('does not invent rows across non-overlapping neighbors or blockers', () => {
    const moving = { x: 103, y: 0, w: 20, h: 20 };
    expect(snapRect(moving, [], 6).spacing).toEqual([]);
    expect(snapRect(moving, [{ ...moving, x: 0, y: 30 }, { ...moving, x: 50 }], 6).spacing).toEqual([]);
    expect(snapRect(moving, [{ ...moving, x: 0 }, { ...moving, x: 50 }, { ...moving, x: 90, w: 5 }], 6).spacing).toEqual([]);
});
