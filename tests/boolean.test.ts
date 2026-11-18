import { describe, expect, it } from 'vitest';
import { combine, regionArea, type Region } from '../src/shared/boolean';

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
