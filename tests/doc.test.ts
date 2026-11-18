import { describe, it, expect } from 'vitest';
import { applyOp, between, makeNode, nodeFills, validNode, type Paint, type Effect, type Doc } from '../src/shared/doc';
describe('paints and effects', () => {
    const solid: Paint = { type: 'solid', color: '#123abc', opacity: .5, visible: true }, gradient: Paint = { type: 'radial', from: { x: -2, y: 0 }, to: { x: 3, y: 1 }, stops: [{ pos: 1, color: '#ffffff', opacity: 1 }, { pos: 0, color: '#000000', opacity: 0 }], opacity: 1, visible: true }, shadow: Effect = { type: 'drop-shadow', x: -4, y: 2, blur: 3, spread: -1, color: '#000000', opacity: .4, visible: true };
    it('accepts all paints, effects and empty lists', () => { const n = makeNode('rect', 0, 0); expect(validNode({ ...n, fills: [solid, gradient, { ...gradient, type: 'linear' }, { type: 'image', asset: 'a'.repeat(64), fit: 'tile', w: 32, h: 16, opacity: 1, visible: false }], effects: [shadow, { ...shadow, type: 'inner-shadow' }, { type: 'layer-blur', radius: 0, visible: true }, { type: 'background-blur', radius: 4, visible: false }] })).toBe(true); expect(validNode({ ...n, fills: [], effects: [] })).toBe(true); });
    it('rejects malformed paints and effects', () => { const n = makeNode('rect', 0, 0); for (const paint of [{ ...solid, color: 'red' }, { ...solid, type: 'unknown' }, { ...solid, opacity: 2 }, { ...solid, visible: 1 }, { ...gradient, stops: [] }, { ...gradient, stops: Array(17).fill(gradient.stops[0]) }, { ...gradient, from: { x: 4, y: 0 } }, { ...gradient, stops: [{ pos: -1, color: '#000000', opacity: 1 }, gradient.stops[0]] }, { type: 'image', asset: 'bad', fit: 'fill', w: 1, h: 1, opacity: 1, visible: true }, null]) expect(validNode({ ...n, fills: [paint] } as any)).toBe(false); for (const effect of [{ ...shadow, blur: -1 }, { ...shadow, color: '#fff' }, { ...shadow, x: Infinity }, { ...shadow, type: 'unknown' }, { type: 'layer-blur', radius: -1, visible: true }, null]) expect(validNode({ ...n, effects: [effect] } as any)).toBe(false); expect(validNode({ ...n, fills: Array(13).fill(solid) })).toBe(false); expect(validNode({ ...n, effects: Array(9).fill(shadow) })).toBe(false); });
    it('sets validated arrays and preserves legacy fallback', () => { const n = makeNode('rect', 0, 0), doc: Doc = new Map([[n.id, n]]); expect(nodeFills(n)).toEqual([{ type: 'solid', color: n.fill, opacity: 1, visible: true }]); applyOp(doc, { t: 'set', id: n.id, key: 'fills', value: [solid] }); applyOp(doc, { t: 'set', id: n.id, key: 'effects', value: [shadow] }); applyOp(doc, { t: 'set', id: n.id, key: 'fills', value: [{ ...solid, color: 'red' }] }); expect(nodeFills(doc.get(n.id)!)).toEqual([solid]); expect(doc.get(n.id)!.effects).toEqual([shadow]); expect(nodeFills({ ...n, fills: [] })).toEqual([]); });
});
describe('document operations', () => {
    it('creates and updates immutable node values', () => { const doc: Doc = new Map(), n = makeNode('rect', 0, 0); applyOp(doc, { t: 'create', node: n }); applyOp(doc, { t: 'set', id: n.id, key: 'x', value: 40 }); expect(doc.get(n.id)?.x).toBe(40); expect(n.x).toBe(0); });
    it('deletes a frame and nested descendants', () => { const doc: Doc = new Map(), a = makeNode('frame', 0, 0), b = { ...makeNode('frame', 1, 1), parent: a.id }, c = { ...makeNode('rect', 2, 2), parent: b.id }; for (const node of [a, b, c])
        applyOp(doc, { t: 'create', node }); applyOp(doc, { t: 'delete', id: a.id }); expect(doc.size).toBe(0); });
    it('ignores missing nodes, duplicate creates, invalid sizes and cycles', () => { const doc: Doc = new Map(), a = makeNode('frame', 0, 0), b = { ...makeNode('frame', 1, 1), parent: a.id }; applyOp(doc, { t: 'delete', id: 'missing' }); applyOp(doc, { t: 'set', id: 'missing', key: 'x', value: 1 }); for (const node of [a, b])
        applyOp(doc, { t: 'create', node }); applyOp(doc, { t: 'create', node: { ...a, x: 999 } }); applyOp(doc, { t: 'set', id: a.id, key: 'parent', value: b.id }); applyOp(doc, { t: 'set', id: a.id, key: 'w', value: -1 }); expect(doc.get(a.id)).toEqual(a); });
});
describe('fractional indexing', () => { it('supports repeated insertion in either direction', () => { let a: string | null = null, b: string | null = null; for (let i = 0; i < 200; i++) {
    const c = between(a, b);
    if (a)
        expect(c > a).toBe(true);
    if (b)
        expect(c < b).toBe(true);
    if (i % 2)
        a = c;
    else
        b = c;
} }); it('appends and prepends', () => { const a = between(); expect(between(a) > a).toBe(true); expect(between(null, a) < a).toBe(true); }); it('rejects reversed bounds', () => { expect(() => between('z', 'A')).toThrow(); }); });
