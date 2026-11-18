import { afterEach, expect, it, vi } from 'vitest';
import { layoutText, measureTextNode } from '../src/client/text-layout';
import { applyOp, makeNode, type Doc, type Op, type TextNode } from '../src/shared/doc';
import { componentOps } from '../src/shared/components';
import { sizeOf, world } from '../src/client/geometry';
import { applyLayout } from '../src/shared/layout';
import { Store } from '../src/client/store';
import { wrapInAutoLayout } from '../src/client/autolayout';

const measure = (text: string) => text.length * 10;
afterEach(() => vi.unstubAllGlobals());

it.each([
    ['auto', 'Wide\nHi\n\nEnd', 40, 96],
    ['auto', '', 1, 24],
    ['fixed', 'Alpha beta\ngamma', 50, 72],
] as const)('wraps %s text using its measured multiline bounds', (textWidth, text, w, h) => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText: (line: string) => ({ width: measure(line) }) }) }) });
    const node = { ...makeNode('text', 10, 20), fontSize: 20, textWidth, text, w: textWidth === 'fixed' ? 50 : 240 };
    const doc: Doc = new Map([[node.id, node]]), before = world(doc, node);
    const { ops, id } = componentOps.create(doc, [node.id], sizeOf);
    for (const op of ops) applyOp(doc, op);
    expect(doc.get(id)).toMatchObject({ x: 10, y: 20, w, h });
    expect(world(doc, doc.get(node.id)!)).toEqual(before);
    expect(doc.get(node.id)).toMatchObject({ x: 0, y: 0, parent: id });
});

it.each(['abcdefgh', ''])('persists measured auto width when text becomes fixed, including reload and undo/redo (%j)', text => {
    const node = { ...makeNode('text', 0, 0), text, w: 240, fontSize: 20 };
    const client = new Store(n => layoutText(n, measure)), worker = new Store();
    client.init([node]); worker.init([node]);
    const width = Math.max(1, text.length * 10), sent: Op[][] = [];
    expect(client.doc.get(node.id)?.w).toBe(width);
    expect(worker.doc.get(node.id)?.w).toBe(240);
    client.send = ops => { sent.push(ops); worker.remote(ops); };
    client.set(node.id, { textWidth: 'fixed' });
    expect(sent).toEqual([[
        { t: 'set', id: node.id, key: 'w', value: width },
        { t: 'set', id: node.id, key: 'textWidth', value: 'fixed' },
    ]]);
    expect(client.undoStack).toHaveLength(1);
    expect(worker.doc.get(node.id)).toMatchObject({ w: width, textWidth: 'fixed' });
    const late = new Store(n => layoutText(n, measure)); late.init([...worker.doc.values()]);
    expect(late.doc.get(node.id)).toEqual(client.doc.get(node.id));
    client.pending.clear(); client.init([...worker.doc.values()]);
    expect(client.doc.get(node.id)?.w).toBe(width);
    client.history(); expect(client.doc.get(node.id)?.textWidth).toBe('auto');
    expect(worker.doc.get(node.id)?.textWidth).toBe('auto');
    client.history(true);
    expect(worker.doc.get(node.id)).toMatchObject({ textWidth: 'fixed', w: width });
    expect(client.doc.get(node.id)?.w).toBe(width);
});

it('retains explicit widths during fixed-width transitions and ignores non-text width mode ops', () => {
    const node = { ...makeNode('text', 0, 0), text: 'abcdefgh', w: 240 };
    const client = new Store(n => layoutText(n, measure)), sent: Op[][] = [];
    client.init([node]); client.send = ops => sent.push(ops);
    client.commit([]); expect(sent).toEqual([]);
    client.set(node.id, { textWidth: 'fixed', w: 50 });
    expect(sent[0]).toHaveLength(2);
    expect(client.doc.get(node.id)?.w).toBe(50);
    client.set(node.id, { textWidth: 'fixed' });
    expect(sent[1]).toEqual([{ t: 'set', id: node.id, key: 'textWidth', value: 'fixed' }]);
    const rect = makeNode('rect', 0, 0); client.doc.set(rect.id, rect);
    client.set(rect.id, { textWidth: 'fixed' });
    expect(sent[2]).toEqual([{ t: 'set', id: rect.id, key: 'textWidth', value: 'fixed' }]);
    expect(client.doc.get(rect.id)).toBe(rect);
    client.set('missing', { textWidth: 'fixed' });
    expect(client.doc.has('missing')).toBe(false);
});

it('persists measured hug-frame height and fill-text width when layout sizing becomes fixed', () => {
    const frame = { ...makeNode('frame', 0, 0), w: 50, h: 100, layout: 'vertical' as const, sizeH: 'hug' as const };
    const text = { ...makeNode('text', 0, 0), parent: frame.id, textWidth: 'fixed' as const, sizeW: 'fill' as const, fontSize: 20, text: 'abcdefghij', w: 240, h: 29 };
    const client = new Store(n => layoutText(n, measure)), worker = new Store(), sent: Op[][] = [];
    client.init([frame, text]); worker.init([frame, text]);
    client.send = ops => { sent.push(ops); worker.remote(ops); };
    expect(client.doc.get(frame.id)?.h).toBe(48); expect(worker.doc.get(frame.id)?.h).toBe(29);
    client.set(frame.id, { sizeH: 'fixed' });
    expect(sent[0]).toEqual([{ t: 'set', id: frame.id, key: 'h', value: 48 }, { t: 'set', id: frame.id, key: 'sizeH', value: 'fixed' }]);
    expect(worker.doc.get(frame.id)?.h).toBe(48);
    client.set(text.id, { sizeW: 'fixed' });
    expect(sent[1]).toEqual([{ t: 'set', id: text.id, key: 'w', value: 50 }, { t: 'set', id: text.id, key: 'sizeW', value: 'fixed' }]);
    const late = new Store(n => layoutText(n, measure)); late.init([...worker.doc.values()]);
    expect(late.doc.get(frame.id)).toEqual(client.doc.get(frame.id));
    expect(late.doc.get(text.id)).toEqual(client.doc.get(text.id));
    client.set(frame.id, { w: 200 });
    expect(client.doc.get(text.id)?.w).toBe(50);
    client.set(frame.id, { sizeH: 'hug' }); client.set(frame.id, { sizeH: 'fixed', h: 80 });
    expect(sent.at(-1)).toEqual([{ t: 'set', id: frame.id, key: 'sizeH', value: 'fixed' }, { t: 'set', id: frame.id, key: 'h', value: 80 }]);
});

it.each(['fixed', 'fill'] as const)('uses measured multiline height instead of text %s height in a vertical hug stack', sizeH => {
    const frame = { ...makeNode('frame', 0, 0), layout: 'vertical' as const, sizeH: 'hug' as const, gap: 7, padTop: 3, padBottom: 5 };
    const text = { ...makeNode('text', 0, 0, 'A'), parent: frame.id, fontSize: 20, text: 'one\ntwo\nthree', h: 1, sizeH };
    const sibling = { ...makeNode('rect', 0, 0, 'B'), parent: frame.id, h: 10 };
    const store = new Store(n => layoutText(n, measure));
    store.init([frame, text, sibling]);
    expect(store.doc.get(text.id)).toMatchObject({ w: 50, h: 72, y: 3 });
    expect(store.doc.get(sibling.id)?.y).toBe(82);
    expect(store.doc.get(frame.id)?.h).toBe(97);
    expect(store.pending.size).toBe(0);
    store.remote([{ t: 'set', id: text.id, key: 'text', value: 'one' }]);
    expect(store.doc.get(sibling.id)?.y).toBe(34);
    store.set(text.id, { text: 'one\ntwo' });
    expect(store.doc.get(frame.id)?.h).toBe(73);
    store.history();
    expect(store.doc.get(frame.id)?.h).toBe(49);
});

it('remeasures fill-width text after assigning width before computing hug height and sibling positions', () => {
    const frame = { ...makeNode('frame', 0, 0), w: 50, layout: 'vertical' as const, sizeH: 'hug' as const };
    const text = { ...makeNode('text', 0, 0, 'A'), parent: frame.id, textWidth: 'fixed' as const, sizeW: 'fill' as const, w: 100, fontSize: 20, text: 'abcdefghij' };
    const sibling = { ...makeNode('rect', 0, 0, 'B'), parent: frame.id, h: 10 };
    const store = new Store(n => layoutText(n, measure));
    store.init([frame, text, sibling]);
    expect(store.doc.get(text.id)).toMatchObject({ w: 50, h: 48 });
    expect(store.doc.get(sibling.id)?.y).toBe(48);
    expect(store.doc.get(frame.id)?.h).toBe(58);
    store.set(frame.id, { w: 100 });
    expect(store.doc.get(text.id)?.h).toBe(24);
    expect(store.doc.get(frame.id)?.h).toBe(34);
    store.measureText = n => layoutText(n, value => value.length * 20);
    store.relayout();
    expect(store.doc.get(text.id)?.h).toBe(48);
    expect(store.doc.get(frame.id)?.h).toBe(58);
});

it('wraps text using measured world bounds rather than its stale stored dimensions', () => {
    const text = { ...makeNode('text', 70, 100), fontSize: 20, text: 'one\ntwo', w: 1, h: 1 };
    const store = new Store(n => layoutText(n, measure));
    store.doc.set(text.id, text);
    const frame = wrapInAutoLayout(store, [text])!;
    expect(frame).toMatchObject({ x: 70, y: 100, w: 30, h: 48 });
    expect(store.doc.get(text.id)).toMatchObject({ x: 0, y: 0, w: 30, h: 48 });
    applyLayout(new Map(), store.measureText);
});

it('invalidates cached text wrapping when fill changes its width without mutating the old node', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText: (text: string) => ({ width: measure(text) }) }) }) });
    try {
        const p = { ...makeNode('frame', 0, 0), layout: 'vertical' as const, w: 50 };
        const text = { ...makeNode('text', 0, 0), parent: p.id, textWidth: 'fixed' as const, sizeW: 'fill' as const, w: 100, text: 'abcdefghij' };
        const doc: Doc = new Map([p, text].map(n => [n.id, n]));
        expect(measureTextNode(text).lines).toEqual(['abcdefghij']);
        applyLayout(doc);
        const resized = doc.get(text.id) as TextNode;
        expect(resized).not.toBe(text);
        expect(text.w).toBe(100);
        expect(measureTextNode(resized).lines).toEqual(['abcde', 'fghij']);
        applyLayout(doc);
        expect(doc.get(text.id)).toBe(resized);
        expect(doc.get(p.id)).toBe(p);
        applyLayout(new Map());
    } finally { vi.unstubAllGlobals(); }
});

it('sizes auto width to the longest explicit line', () => {
    const node = { ...makeNode('text', 0, 0), fontSize: 20, w: 1, text: 'Wide\r\nHi\n' };
    expect(layoutText(node, measure)).toEqual({ lines: ['Wide', 'Hi', ''], w: 40, h: 72, leading: 24 });
});

it('wraps fixed width without collapsing internal spaces or explicit newlines', () => {
    const node = { ...makeNode('text', 0, 0), textWidth: 'fixed' as const, w: 50, text: 'A  B word\n123456' };
    expect(layoutText(node, measure).lines).toEqual(['A  B', 'word', '12345', '6']);
});

it('leaves a combined emoji intact even if it overruns a narrow box', () => {
    const node = { ...makeNode('text', 0, 0), textWidth: 'fixed' as const, w: 10, text: '👩‍💻!' };
    expect(layoutText(node, measure).lines).toEqual(['👩‍💻', '!']);
});
