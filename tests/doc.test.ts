import { describe, it, expect } from 'vitest';
import { applyOp, between, makeNode, maxTextLength, type Doc } from '../src/shared/doc';
describe('document operations', () => {
    it('accepts text content and typography as independent properties', () => {
        const doc: Doc = new Map(), node = makeNode('text', 12, 30);
        applyOp(doc, { t: 'create', node });
        applyOp(doc, { t: 'set', id: node.id, key: 'text', value: 'Made together\nSecond line' });
        applyOp(doc, { t: 'set', id: node.id, key: 'fontFamily', value: 'serif' });
        applyOp(doc, { t: 'set', id: node.id, key: 'fontSize', value: 32 });
        applyOp(doc, { t: 'set', id: node.id, key: 'fontWeight', value: 700 });
        applyOp(doc, { t: 'set', id: node.id, key: 'textAlign', value: 'center' });
        applyOp(doc, { t: 'set', id: node.id, key: 'textWidth', value: 'fixed' });
        expect(doc.get(node.id)).toMatchObject({ text: 'Made together\nSecond line', fontFamily: 'serif', fontSize: 32, fontWeight: 700, textAlign: 'center', textWidth: 'fixed' });
    });
    it('rejects invalid typography and incomplete text nodes', () => {
        const doc: Doc = new Map(), node = makeNode('text', 0, 0), shape = makeNode('rect', 0, 0);
        applyOp(doc, { t: 'create', node });
        applyOp(doc, { t: 'create', node: shape });
        applyOp(doc, { t: 'create', node: { ...shape, id: 'incomplete', type: 'text' } });
        applyOp(doc, { t: 'set', id: node.id, key: 'text', value: 'x'.repeat(maxTextLength + 1) });
        applyOp(doc, { t: 'set', id: node.id, key: 'fontFamily', value: 'unknown' });
        applyOp(doc, { t: 'set', id: node.id, key: 'fontSize', value: Infinity });
        applyOp(doc, { t: 'set', id: node.id, key: 'fontWeight', value: 22 });
        applyOp(doc, { t: 'set', id: shape.id, key: 'text', value: 'not a text layer' });
        expect(doc.size).toBe(2);
        expect(doc.get(node.id)).toEqual(node);
        expect(doc.get(shape.id)).toEqual(shape);
    });
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
