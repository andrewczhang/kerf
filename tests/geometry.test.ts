import { it, expect } from 'vitest';
import { makeNode, type Doc } from '../src/shared/doc';
import { hit, world, handles, bounds, transform } from '../src/shared/geometry';
it('returns nothing for an empty document', () => expect(hit(new Map(), { x: 0, y: 0 })).toBeUndefined());
it('tests ellipse precisely and resolves z-order', () => { const a = makeNode('rect', 0, 0, 'A'), b = makeNode('ellipse', 0, 0, 'B'), doc: Doc = new Map([[a.id, a], [b.id, b]]); expect(hit(doc, { x: 50, y: 50 })?.id).toBe(b.id); expect(hit(doc, { x: 1, y: 1 })?.id).toBe(a.id); });
it('clips children to parent frame and uses parent-relative positions', () => { const a = makeNode('frame', 100, 100), b = { ...makeNode('rect', 80, 10), parent: a.id }, doc: Doc = new Map([[a.id, a], [b.id, b]]); expect(world(doc, b).x).toBe(180); expect(hit(doc, { x: 190, y: 120 })?.id).toBe(b.id); expect(hit(doc, { x: 220, y: 120 })).toBeUndefined(); });
it('handles empty bounds and affine coordinates', () => { expect(bounds([]).w).toBe(0); expect(handles({ x: 0, y: 0, w: 100, h: 50 })[4]).toEqual({ x: 100, y: 50 }); expect(transform([2, 0, 0, 2, 10, 20], { x: 3, y: 4 })).toEqual({ x: 16, y: 28 }); });
