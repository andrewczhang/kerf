import { it, expect } from 'vitest';
import { makeNode, type Doc, type Node } from '../src/shared/doc';
import { hit, world, handles, bounds, transform } from '../src/shared/geometry';
import { corner } from '../src/shared/path';
it('returns nothing for an empty document', () => expect(hit(new Map(), { x: 0, y: 0 })).toBeUndefined());
it('tests ellipse precisely and resolves z-order', () => { const a = makeNode('rect', 0, 0, 'A'), b = makeNode('ellipse', 0, 0, 'B'), doc: Doc = new Map([[a.id, a], [b.id, b]]); expect(hit(doc, { x: 50, y: 50 })?.id).toBe(b.id); expect(hit(doc, { x: 1, y: 1 })?.id).toBe(a.id); });
it('clips children to parent frame and uses parent-relative positions', () => { const a = makeNode('frame', 100, 100), b = { ...makeNode('rect', 80, 10), parent: a.id }, doc: Doc = new Map([[a.id, a], [b.id, b]]); expect(world(doc, b).x).toBe(180); expect(hit(doc, { x: 190, y: 120 })?.id).toBe(b.id); expect(hit(doc, { x: 220, y: 120 })).toBeUndefined(); });
it('handles empty bounds and affine coordinates', () => { expect(bounds([]).w).toBe(0); expect(handles({ x: 0, y: 0, w: 100, h: 50 })[4]).toEqual({ x: 100, y: 50 }); expect(transform([2, 0, 0, 2, 10, 20], { x: 3, y: 4 })).toEqual({ x: 16, y: 28 }); });

it('selects the outside stroke of a rectangle and ellipse, but not the ellipse box corners', () => {
    for (const type of ['rect', 'ellipse'] as const) {
        const node: Node = { ...makeNode(type, 0, 0), stroke: '#000', strokeWidth: 12, strokeAlign: 'outside' };
        const doc: Doc = new Map([[node.id, node]]);
        expect(hit(doc, { x: 110, y: 50 })).toBe(node);
        expect(hit(doc, { x: 113, y: 50 })).toBeUndefined();
        node.stroke = null;
        expect(hit(doc, { x: 110, y: 50 })).toBeUndefined();
    }
    const ellipse = { ...makeNode('ellipse', 0, 0), stroke: '#000', strokeWidth: 12, strokeAlign: 'outside' as const };
    expect(hit(new Map([[ellipse.id, ellipse]]), { x: 101, y: 101 })).toBeUndefined();
});

it('selects a closed path on the outside stroke, including a miter tip', () => {
    const node: Node = { ...makeNode('path', 0, 0), closed: true, points: [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)], strokeWidth: 10, strokeAlign: 'outside', strokeJoin: 'miter' };
    const doc: Doc = new Map([[node.id, node]]);
    expect(hit(doc, { x: -8, y: 50 })).toBe(node);
    expect(hit(doc, { x: -9, y: -9 })).toBe(node);
    expect(hit(doc, { x: -11, y: -11 })).toBeUndefined();
});

it('selects an arrowhead outside a group box, but clips it at a frame boundary', () => {
    const group = makeNode('group', 0, 0);
    const node = { ...makeNode('path', 0, 0), parent: group.id, points: [corner(0, 0), corner(1, 0)], strokeWidth: 10, strokeEnd: 'triangle' as const };
    const doc: Doc = new Map([[group.id, group], [node.id, node]]);
    const p = { x: 66, y: -15 };
    expect(hit(doc, p)).toBe(node);
    expect(hit(doc, { x: 40, y: -15 })).toBeUndefined();
    doc.set(group.id, { ...group, type: 'frame' });
    expect(hit(doc, p)).toBeUndefined();
});
