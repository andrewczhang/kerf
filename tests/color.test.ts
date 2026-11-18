import { expect, it } from 'vitest';
import { hexRgb, rgbHex, rgbHsv, hsvRgb, rgbHsl, hslRgb, harmonies, curatedPalettes } from '../src/shared/color';
it('round trips primaries, neutrals and arbitrary colors through HSV and HSL', () => {
    for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#839a2c', '#777777']) {
        expect(rgbHex(hsvRgb(rgbHsv(hexRgb(hex))))).toBe(hex);
        expect(rgbHex(hslRgb(rgbHsl(hexRgb(hex))))).toBe(hex);
    }
});
it('rejects invalid and empty hex and clamps channels', () => {
    for (const value of ['', '#fff', '#zz0000']) expect(() => hexRgb(value)).toThrow();
    expect(rgbHex([-1, 999, 128])).toBe('#00ff80');
});
it('generates wrapped harmonies and valid neutral palettes', () => {
    expect(harmonies('#ff0000')[0].colors).toEqual(['#ff0000', '#00ffff']);
    for (const hex of ['#000000', '#ffffff', '#ff0080']) {
        expect(harmonies(hex)).toHaveLength(6);
        for (const p of harmonies(hex)) for (const c of p.colors) expect(c).toMatch(/^#[\da-f]{6}$/);
    }
    expect(() => harmonies('')).toThrow();
    expect(curatedPalettes.every(p => p.colors.length === 5)).toBe(true);
});
