export type Triple = [number, number, number];
const clamp = (n: number, max = 1) => Math.max(0, Math.min(max, n));
export function hexRgb(hex: string): Triple {
    if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error('Expected six-digit hex color');
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as Triple;
}
export function rgbHex(rgb: Triple): string { return '#' + rgb.map(n => Math.round(clamp(n, 255)).toString(16).padStart(2, '0')).join(''); }
export function rgbHsv([r, g, b]: Triple): Triple {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    const h = !d ? 0 : max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}
export function hsvRgb([h, s, v]: Triple): Triple {
    h = ((h % 360) + 360) % 360 / 60; s = clamp(s); v = clamp(v);
    const c = v * s, x = c * (1 - Math.abs(h % 2 - 1)), m = v - c;
    const rgb = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
    return rgb.map(n => Math.round((n + m) * 255)) as Triple;
}
export function rgbHsl(rgb: Triple): Triple {
    const [h, s, v] = rgbHsv(rgb), l = v * (1 - s / 2);
    return [h, l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l];
}
export function hslRgb([h, s, l]: Triple): Triple { const v = l + s * Math.min(l, 1 - l); return hsvRgb([h, v ? 2 * (1 - l / v) : 0, v]); }
export interface Palette { name: string; colors: string[] }
export function harmonies(hex: string): Palette[] {
    const [h, s, v] = rgbHsv(hexRgb(hex));
    return Object.entries({ Complementary: [0, 180], Analogous: [-30, 0, 30], Triadic: [0, 120, 240], 'Split-complementary': [0, 150, 210], Tetradic: [0, 90, 180, 270] }).map(([name, offsets]) => ({ name, colors: offsets.map(d => rgbHex(hsvRgb([h + d, s, v]))) })).concat([{ name: 'Monochrome', colors: [.2, .4, .6, .8, 1].map(l => rgbHex(hslRgb([h, s, l]))) }]);
}
export const curatedPalettes: Palette[] = [
    { name: 'Mineral', colors: ['#253c3b', '#587b73', '#a7b8a0', '#e5dfcd', '#ba7657'] },
    { name: 'Ink & paper', colors: ['#24272b', '#555e68', '#929ba3', '#d3cec4', '#f3efe6'] },
    { name: 'Orchard', colors: ['#37452c', '#82905b', '#dfc878', '#b96b42', '#f0e6cf'] },
    { name: 'Tidal', colors: ['#193b50', '#386b80', '#81aaa7', '#e2dbbd', '#cf785e'] },
    { name: 'Clay', colors: ['#533e43', '#976265', '#cd9683', '#e5c3a8', '#f4eadb'] },
    { name: 'Evening', colors: ['#302e4c', '#625879', '#a18497', '#d7b5a5', '#f1dfc3'] },
];
