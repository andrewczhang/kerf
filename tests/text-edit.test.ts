import { expect, it } from 'vitest';
import { mergeText } from '../src/shared/text-edit';

it('keeps an insertion in the middle when the peer has inserted at both ends', () => {
    const base = 'WEEKEND STUDIO', middle = 'WEEKEND DESIGN STUDIO', ends = 'THE WEEKEND STUDIO HQ';
    const merged = 'THE WEEKEND DESIGN STUDIO HQ';
    expect(mergeText(base, middle, ends)).toBe(merged);
    expect(mergeText(base, ends, middle)).toBe(merged);
});
it('preserves a changed middle when the peer replaced text at both ends', () => {
    const base = 'A dog sleeps on the mat.';
    expect(mergeText(base, 'A dog naps on the mat.', 'The dog sleeps on the rug!')).toBe('The dog naps on the rug!');
});
