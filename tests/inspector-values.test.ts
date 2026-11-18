import { expect, it, vi } from 'vitest';
import { formatNumber, inputElement, parseColor } from '../src/client/ui/values';

it('creates inspector inputs with password-manager exclusions', () => {
    const attributes = new Map<string, string>();
    const input = { autocomplete: '', setAttribute: (key: string, value: string) => attributes.set(key, value) };
    vi.stubGlobal('document', { createElement: () => input });
    try {
        expect(inputElement('Gap')).toBe(input);
        expect(input.autocomplete).toBe('off');
        expect(attributes.get('aria-label')).toBe('Gap');
        expect(attributes.has('data-1p-ignore')).toBe(true);
        expect(attributes.get('data-lpignore')).toBe('true');
    } finally { vi.unstubAllGlobals(); }
});

it('formats integers and at most two decimals without trailing zeroes', () => {
    expect(formatNumber(10)).toBe('10');
    expect(formatNumber(154.85678)).toBe('154.86');
    expect(formatNumber(1.5)).toBe('1.5');
    expect(formatNumber(-0.001)).toBe('0');
    expect(formatNumber(NaN)).toBe('');
});
it('normalizes hex colors and accepts None only for nullable stroke', () => {
    expect(parseColor(' AABBCC ')).toBe('#aabbcc');
    expect(parseColor('#ff4f00')).toBe('#ff4f00');
    expect(parseColor('None', true)).toBeNull();
    expect(parseColor('None')).toBeUndefined();
    expect(parseColor('')).toBeUndefined();
    expect(parseColor('#xyzxyz')).toBeUndefined();
});
