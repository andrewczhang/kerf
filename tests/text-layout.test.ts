import { afterEach, expect, it, vi } from 'vitest';
import { layoutText } from '../src/client/text-layout';
import { applyOp, makeNode, type Doc } from '../src/shared/doc';
import { componentOps } from '../src/shared/components';
import { sizeOf, world } from '../src/client/geometry';

const measure = (text: string) => text.length * 10;
afterEach(() => vi.unstubAllGlobals());

it.each([
    ['auto', 'Wide\nHi\n\nEnd', 40, 96],
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
