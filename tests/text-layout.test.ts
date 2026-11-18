import { expect, it, vi } from 'vitest';
import { layoutText, measureTextNode } from '../src/client/text-layout';
import { makeNode, type Doc, type TextNode } from '../src/shared/doc';
import { applyLayout } from '../src/shared/layout';

const measure = (text: string) => text.length * 10;

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
