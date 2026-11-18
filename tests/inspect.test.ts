import { describe, expect, it } from 'vitest';
import { inspectCSS, measurements } from '../src/shared/inspect';
import { makeNode } from '../src/shared/doc';

describe('measurements', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    it('measures separated horizontal and vertical edge gaps', () => {
        expect(measurements(a, { ...a, x: 130, y: 140 }).map(m => m.distance)).toEqual([30, 40]);
    });
    it('measures all four container insets in either direction', () => {
        const b = { x: 10, y: 20, w: 60, h: 50 };
        expect(measurements(a, b).map(m => m.distance)).toEqual([10, 30, 20, 30]);
        expect(measurements(b, a).map(m => m.distance)).toEqual([10, 30, 20, 30]);
    });
    it('measures overlapping edges and rounds document units', () => {
        expect(measurements(a, { ...a, x: 50.4, y: 60 }).map(m => m.distance)).toEqual([50, 50, 60, 60]);
    });
    it('handles coincident and touching bounds', () => {
        expect(measurements(a, a).every(m => m.distance === 0)).toBe(true);
        expect(measurements(a, { ...a, x: 100 })[0].distance).toBe(0);
    });
});
describe('inspectCSS', () => {
    it('handles empty selection', () => expect(inspectCSS()).toBe(''));
    it('uses parent-local coordinates and appearance', () => {
        const css = inspectCSS({ ...makeNode('rect', 12, 34), parent: 'frame', stroke: '#123456', radius: 8, opacity: .5 });
        expect(css).toContain('left: 12px;\ntop: 34px;');
        expect(css).toContain('border: 1px solid #123456;');
        expect(css).toContain('border-radius: 8px;\nopacity: 0.5;');
        expect(css).not.toContain('transform');
    });
    it('supports ellipses and text without inventing unavailable properties', () => {
        expect(inspectCSS(makeNode('ellipse', 0, 0))).toContain('border-radius: 50%;');
        const css = inspectCSS(makeNode('text', 0, 0));
        expect(css).toContain('font-family: Arial, sans-serif;');
        expect(css).toContain('color: #272822;');
        expect(css).not.toMatch(/letter-spacing|line-height|background/);
    });
    it('does not emit hidden fills or absent optional typography', () => {
        expect(inspectCSS({ ...makeNode('rect', 0, 0), fills: [] })).not.toContain('background');
    });
});
