import { describe, expect, it } from 'vitest';
import { applyOp, makeNode, validNode, type Doc, type Op } from '../src/shared/doc';
import { detachOps, resolveStyleOps, styleOps, validStyle, type Style } from '../src/shared/styles';
import { expand, instanceNode } from '../src/shared/components';
const color: Style = { id: 'orange', kind: 'color', name: 'Accent', color: '#123456' };
describe('shared styles', () => {
    it('updates and deletes root and nested override links, including restored links', () => {
        const main = { ...makeNode('frame', 0, 0), component: true }, text = { ...makeNode('text', 0, 0), parent: main.id };
        const nested = instanceNode(main, 0, 0), outer = { ...makeNode('frame', 0, 0), component: true };
        nested.parent = outer.id;
        const instance = { ...instanceNode(outer, 200, 0), overrides: { '': { fillStyle: color.id }, [nested.id + '/' + text.id]: { textStyle: 'title' } } };
        const doc: Doc = new Map([main, text, outer, nested, instance].map(n => [n.id, n]));
        const title: Style = { id: 'title', kind: 'text', name: 'Title', fontFamily: 'serif', fontSize: 48, fontWeight: 700 };
        for (const op of [...styleOps(doc, color), ...styleOps(doc, title)]) applyOp(doc, op);
        expect(expand(doc).get(instance.id)?.fill).toBe(color.color);
        expect(expand(doc).get(instance.id + '/' + nested.id + '/' + text.id)).toMatchObject({ fontSize: 48, fontWeight: 700 });
        expect(styleOps(doc, color)).toEqual([]); expect(styleOps(doc, title)).toEqual([]);
        for (const op of [...detachOps(doc, color.id), ...detachOps(doc, title.id)]) applyOp(doc, op);
        expect(doc.get(instance.id)?.overrides?.['']).toMatchObject({ fillStyle: null, fill: color.color });
        expect(doc.get(instance.id)?.overrides?.[nested.id + '/' + text.id]?.textStyle).toBeNull();
        const relink: Op = { t: 'override', id: instance.id, target: '', key: 'fillStyle', value: color.id };
        applyOp(doc, relink);
        const updated = { ...color, color: '#abcdef' };
        for (const op of resolveStyleOps(doc, [updated], [relink])) applyOp(doc, op);
        expect(expand(doc).get(instance.id)?.fill).toBe('#abcdef');
        expect(styleOps(doc, { ...title, fontSize: 70 })).toEqual([]);
        expect(detachOps(doc, 'missing')).toEqual([]);
    });
    it('preserves normalized rotation while linked color and text styles update', () => {
        const doc: Doc = new Map(), textStyle: Style = { id: 'title', kind: 'text', name: 'Title', fontFamily: 'serif', fontSize: 48, fontWeight: 700 }, n = { ...makeNode('text', 0, 0), rotation: 390, fillStyle: color.id, textStyle: textStyle.id };
        applyOp(doc, { t: 'create', node: n });
        [...styleOps(doc, color), ...styleOps(doc, textStyle)].forEach(op => applyOp(doc, op));
        expect(doc.get(n.id)).toMatchObject({ rotation: 30, fill: color.color, fillStyle: color.id, textStyle: textStyle.id, fontSize: 48 });
        applyOp(doc, { t: 'set', id: n.id, key: 'rotation', value: -390 }); applyOp(doc, { t: 'set', id: n.id, key: 'rotation', value: Infinity });
        expect(doc.get(n.id)).toMatchObject({ rotation: -30, fillStyle: color.id, textStyle: textStyle.id });
    });
    it('resolves restored links using the latest style, only on relinked nodes', () => {
        const n = { ...makeNode('rect', 0, 0), fillStyle: color.id, strokeStyle: color.id };
        const text = { ...makeNode('text', 0, 0), textStyle: 'title' };
        const other = { ...n, id: 'other' }, doc: Doc = new Map([n, text, other].map(node => [node.id, node]));
        const links: Op[] = [{ t: 'set', id: n.id, key: 'fillStyle', value: color.id }, { t: 'set', id: n.id, key: 'strokeStyle', value: color.id }, { t: 'set', id: text.id, key: 'textStyle', value: 'title' }];
        const styles: Style[] = [color, { id: 'title', kind: 'text', name: 'Title', fontFamily: 'serif', fontSize: 48, fontWeight: 700 }];
        const resolved = resolveStyleOps(doc, styles, links);
        expect(resolved.every(op => op.t === 'set' && op.id !== other.id)).toBe(true);
        resolved.forEach(op => applyOp(doc, op));
        expect(doc.get(n.id)).toMatchObject({ fill: color.color, stroke: color.color });
        expect(doc.get(text.id)).toMatchObject({ fontFamily: 'serif', fontSize: 48, fontWeight: 700 });
        expect(doc.get(other.id)?.fill).toBe('#ff4f00');
        expect(resolveStyleOps(doc, styles, links)).toEqual([]);
        expect(resolveStyleOps(doc, styles, [])).toEqual([]);
        expect(resolveStyleOps(doc, [], links)).toEqual([]);
        expect(resolveStyleOps(new Map(), styles, links)).toEqual([]);
        applyOp(doc, { t: 'set', id: n.id, key: 'fillStyle', value: null });
        expect(resolveStyleOps(doc, styles, [links[0]])).toEqual([]);
    });
    it('validates color and text styles and rejects malformed values', () => {
        expect(validStyle(color)).toBe(true);
        expect(validStyle({ id: 't', kind: 'text', name: 'Title', fontFamily: 'sans', fontSize: 24, fontWeight: 700 })).toBe(true);
        for (const value of [null, {}, { ...color, color: '#fff' }, { ...color, name: '' }, { ...color, kind: 'other' }, { id: 't', kind: 'text', name: 'T', fontFamily: 'sans', fontSize: 513, fontWeight: 400 }]) expect(validStyle(value)).toBe(false);
    });
    it('rewrites linked colors including rendered fills without mutating the document', () => {
        const n = { ...makeNode('rect', 0, 0), fillStyle: color.id, strokeStyle: color.id };
        const doc: Doc = new Map([[n.id, n]]), ops = styleOps(doc, color);
        expect(doc.get(n.id)?.fill).toBe('#ff4f00');
        ops.forEach(op => applyOp(doc, op));
        expect(doc.get(n.id)).toMatchObject({ fill: '#123456', stroke: '#123456', fills: [{ type: 'solid', color: '#123456' }] });
        expect(styleOps(doc, color)).toEqual([]);
        expect(styleOps(new Map(), color)).toEqual([]);
        expect(styleOps(doc, { ...color, color: 'bad' })).toEqual([]);
    });
    it('rewrites text typography and detaches without losing values', () => {
        const n = { ...makeNode('text', 0, 0), textStyle: 'title', fillStyle: 'other' }, doc: Doc = new Map([[n.id, n]]);
        styleOps(doc, { id: 'title', kind: 'text', name: 'Title', fontFamily: 'serif', fontSize: 48, fontWeight: 700 }).forEach(op => applyOp(doc, op));
        detachOps(doc, 'title').forEach(op => applyOp(doc, op));
        expect(doc.get(n.id)).toMatchObject({ textStyle: null, fontFamily: 'serif', fontSize: 48, fontWeight: 700, fillStyle: 'other' });
        expect(detachOps(doc, 'missing')).toEqual([]);
        expect(detachOps(new Map(), 'title')).toEqual([]);
    });
    it('accepts nullable links and gates text links to text nodes', () => {
        const n = makeNode('rect', 0, 0), doc: Doc = new Map([[n.id, n]]);
        for (const value of ['style', null, undefined]) { applyOp(doc, { t: 'set', id: n.id, key: 'fillStyle', value }); expect(doc.get(n.id)?.fillStyle).toBe(value); }
        applyOp(doc, { t: 'set', id: n.id, key: 'textStyle', value: 'text' });
        expect(doc.get(n.id)?.textStyle).toBeUndefined();
        applyOp(doc, { t: 'set', id: n.id, key: 'strokeStyle', value: 42 } as Op);
        expect(doc.get(n.id)?.strokeStyle).toBeUndefined();
        expect(validNode({ ...n, fillStyle: 42 } as never)).toBe(false);
    });
});
