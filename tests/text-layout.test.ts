import { expect, it, vi } from 'vitest';
import { layoutText, measureTextNode } from '../src/client/text-layout';
import { makeNode, type Doc, type TextNode } from '../src/shared/doc';
import { applyLayout } from '../src/shared/layout';
import { Store } from '../src/client/store';
import { wrapInAutoLayout } from '../src/client/autolayout';

const measure = (text: string) => text.length * 10;

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
