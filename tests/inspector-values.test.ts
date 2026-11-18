import { expect, it } from 'vitest';
import { formatNumber, parseColor } from '../src/client/ui/values';

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
