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
