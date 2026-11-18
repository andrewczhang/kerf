import { expect, it } from 'vitest';
import { applyOp, layoutDefaults, makeNode, validNode, type Doc, type Key, type Node, type Op } from '../src/shared/doc';
import { applyLayout } from '../src/shared/layout';
import { Store } from '../src/client/store';

function fixture(layout: Node['layout'] = 'horizontal') {
    const p = { ...makeNode('frame', 99, 99), layout, w: 200, h: 200, padLeft: 10, padRight: 20, padTop: 30, padBottom: 40, gap: 10 };
    const a = { ...makeNode('rect', 80, 80, 'A'), parent: p.id, w: 20, h: 20 };
    const b = { ...makeNode('rect', 80, 80, 'B'), parent: p.id, w: 40, h: 40 };
    const doc: Doc = new Map([b, p, a].map(n => [n.id, n]));
    return { p, a, b, doc };
}

it.each(['horizontal', 'vertical'] as const)('lays out %s in index order with gap and padding', direction => {
    const { doc, p, a, b } = fixture(direction);
    applyLayout(doc);
    expect([doc.get(a.id)!.x, doc.get(a.id)!.y, doc.get(b.id)!.x, doc.get(b.id)!.y]).toEqual(direction === 'horizontal' ? [10, 30, 40, 30] : [10, 30, 10, 60]);
    expect([doc.get(p.id)!.x, doc.get(p.id)!.y]).toEqual([99, 99]);
});

it.each(['horizontal', 'vertical'] as const)('supports every justify and align in %s', direction => {
    for (const justify of ['start', 'center', 'end', 'between'] as const) {
        for (const align of ['start', 'center', 'end'] as const) {
            const { doc, p, a, b } = fixture(direction);
            p.justify = justify; p.align = align;
            applyLayout(doc);
            const horizontal = direction === 'horizontal';
            const spare = horizontal ? 100 : 60;
            const start = horizontal ? 10 : 30;
            const offset = justify === 'center' ? spare / 2 : justify === 'end' ? spare : 0;
            expect(doc.get(a.id)![horizontal ? 'x' : 'y']).toBe(start + offset);
            expect(doc.get(b.id)![horizontal ? 'x' : 'y']).toBe(start + offset + 30 + (justify === 'between' ? spare : 0));
            expect(doc.get(a.id)![horizontal ? 'y' : 'x']).toBe((horizontal ? 30 : 10) + (align === 'center' ? (horizontal ? 110 : 150) / 2 : align === 'end' ? (horizontal ? 110 : 150) : 0));
        }
    }
});

it('uses start for a single between child and preserves empty hug frames', () => {
    const { doc, p, a, b } = fixture();
    doc.delete(b.id); p.justify = 'between'; applyLayout(doc); expect(doc.get(a.id)!.x).toBe(10);
    doc.delete(a.id); p.sizeW = 'hug'; p.sizeH = 'hug'; applyLayout(doc);
    expect([doc.get(p.id)!.w, doc.get(p.id)!.h]).toEqual([200, 200]);
    applyLayout(new Map());
});

it.each(['horizontal', 'vertical'] as const)('hugs both axes in %s and treats fill as fixed', direction => {
    const { doc, p, a } = fixture(direction);
    p.sizeW = 'hug'; p.sizeH = 'hug'; a.sizeW = 'fill'; a.sizeH = 'fill';
    applyLayout(doc);
    expect([doc.get(p.id)!.w, doc.get(p.id)!.h]).toEqual(direction === 'horizontal' ? [100, 110] : [70, 140]);
    expect([doc.get(a.id)!.w, doc.get(a.id)!.h]).toEqual([20, 20]);
});

it.each(['horizontal', 'vertical'] as const)('splits main fill and stretches cross fill in %s with minimum sizes', direction => {
    const { doc, p, a, b } = fixture(direction);
    a.sizeW = b.sizeW = a.sizeH = b.sizeH = 'fill'; applyLayout(doc);
    expect([doc.get(a.id)!.w, doc.get(a.id)!.h, doc.get(b.id)!.w, doc.get(b.id)!.h]).toEqual(direction === 'horizontal' ? [80, 130, 80, 130] : [170, 60, 170, 60]);
    p.w = p.h = 1; applyLayout(doc);
    expect([doc.get(a.id)!.w, doc.get(a.id)!.h, doc.get(b.id)!.w, doc.get(b.id)!.h]).toEqual([1, 1, 1, 1]);
});

it('subtracts fixed children before distributing fill', () => {
    const { doc, a } = fixture(); a.sizeW = 'fill'; applyLayout(doc); expect(doc.get(a.id)!.w).toBe(120);
});

it('computes nested hug before fill and then sizes grandchildren from the filled frame', () => {
    const { doc, p, a, b } = fixture();
    a.type = 'frame'; a.layout = 'vertical'; a.sizeW = 'fill'; a.sizeH = 'hug'; a.padTop = 5; a.padBottom = 5;
    const c = { ...makeNode('rect', 90, 90), parent: a.id, w: 10, h: 25, sizeW: 'fill' as const };
    doc.set(c.id, c); applyLayout(doc);
    expect([doc.get(a.id)!.w, doc.get(a.id)!.h, doc.get(c.id)!.w, doc.get(c.id)!.h, doc.get(c.id)!.x, doc.get(c.id)!.y, doc.get(b.id)!.x]).toEqual([120, 35, 120, 25, 0, 5, 140]);
    const snapshot = JSON.stringify([...doc]); applyLayout(doc); expect(JSON.stringify([...doc])).toBe(snapshot);
    expect(doc.get(p.id)!.w).toBe(200);
});

it('ignores hug on non-auto frames and fill outside auto parents', () => {
    const { doc, p, a } = fixture('none'); p.sizeW = 'hug'; a.sizeW = a.sizeH = 'fill';
    applyLayout(doc); expect([doc.get(p.id)!.w, doc.get(a.id)!.x, doc.get(a.id)!.y, doc.get(a.id)!.w, doc.get(a.id)!.h]).toEqual([200, 80, 80, 20, 20]);
    p.type = 'rect'; p.layout = 'horizontal'; applyLayout(doc); expect(doc.get(a.id)!.x).toBe(80);
});

it('accepts all new keys, rejects invalid values on create/set, and permits resetting defaults', () => {
    const n = makeNode('frame', 0, 0), doc: Doc = new Map([[n.id, n]]);
    const values = { ...layoutDefaults, layout: 'vertical', gap: 4, padTop: 1, padRight: 2, padBottom: 3, padLeft: 4, justify: 'between', align: 'end', sizeW: 'hug', sizeH: 'fill' };
    for (const [key, value] of Object.entries(values)) {
        applyOp(doc, { t: 'set', id: n.id, key, value } as Op);
        expect(doc.get(n.id)?.[key as Key]).toBe(value);
    }
    for (const key of Object.keys(values)) {
        const invalid = key.startsWith('pad') || key === 'gap' ? [-1, NaN, Infinity, '1', null] : ['invalid', 1, null];
        for (const value of invalid) {
            const before = doc.get(n.id);
            applyOp(doc, { t: 'set', id: n.id, key, value } as Op); expect(doc.get(n.id)).toBe(before);
            const node = { ...n, id: 'bad', [key]: value };
            expect(validNode(node)).toBe(false); applyOp(doc, { t: 'create', node }); expect(doc.has('bad')).toBe(false);
        }
        applyOp(doc, { t: 'set', id: n.id, key, value: undefined } as Op);
        expect(doc.get(n.id)?.[key as Key]).toBeUndefined();
    }
});

it('recomputes on store init, commit, remote and history without sending derived ops', () => {
    const { p, a, b } = fixture(); const s = new Store(); s.init([p, a, b]);
    expect(s.doc.get(b.id)?.x).toBe(40);
    s.set(p.id, { gap: 30 }); expect(s.doc.get(b.id)?.x).toBe(60);
    expect([...s.pending.values()].flat().map(o => o.t === 'set' && o.key)).toEqual(['gap']);
    s.history(); expect(s.doc.get(b.id)?.x).toBe(40);
    s.history(true); expect(s.doc.get(b.id)?.x).toBe(60);
    s.pending.clear(); s.remote([{ t: 'set', id: p.id, key: 'gap', value: 50 }]); expect(s.doc.get(b.id)?.x).toBe(80);
    s.init([p, a, b]); expect(s.doc.get(b.id)?.x).toBe(40);
});
