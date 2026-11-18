import { expect, it } from 'vitest';
import { layoutText } from '../src/client/text-layout';
import { makeNode } from '../src/shared/doc';

const measure = (text: string) => text.length * 10;

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
