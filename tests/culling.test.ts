import { expect, it, vi, afterEach } from 'vitest';
import { makeNode, type Doc, type Node } from '../src/shared/doc';
import { inViewport, renderBounds } from '../src/client/culling';
import { drawNode } from '../src/client/draw';
import { clearTextLayouts } from '../src/client/text-layout';

const view = { x: 0, y: 0, w: 100, h: 100 };
const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
afterEach(() => { clearTextLayouts(); vi.unstubAllGlobals(); });

it('culls offscreen geometry but keeps touching edges, groups and conservative stroke bounds', () => {
    const outside = makeNode('rect', 200, 200), edge = makeNode('ellipse', 100, 50), group = makeNode('group', 1000, 1000);
    expect(inViewport(docOf(outside), outside, view, 1)).toBe(false);
    expect(inViewport(docOf(edge), edge, view, 1)).toBe(true);
    expect(inViewport(docOf(group), group, view, 1)).toBe(true);
    const stroke = { ...makeNode('rect', 110, 10), stroke: '#000000', strokeWidth: 20, strokeAlign: 'outside' as const };
    expect(inViewport(docOf(stroke), stroke, view, 1)).toBe(true);
    expect(inViewport(new Map(), outside, view, 1)).toBe(false);
    const path = { ...makeNode('path', 200, 0), points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: -3, oy: 0 }, { x: 1, y: 1, ix: -3, iy: 1, ox: 1, oy: 1 }] };
    expect(inViewport(docOf(path), path, view, 1)).toBe(true);
});

it('includes offset shadows, accumulated layer blur and labels at every zoom', () => {
    const n = makeNode('rect', 160, 0);
    const shadow = { ...n, effects: [{ type: 'drop-shadow' as const, x: -80, y: 0, blur: 4, spread: 2, color: '#000000', opacity: 1, visible: true }] };
    expect(inViewport(docOf(shadow), shadow, view, 1)).toBe(true);
    const hidden = { ...shadow, effects: [{ ...shadow.effects[0], visible: false }] };
    expect(inViewport(docOf(hidden), hidden, view, 1)).toBe(false);
    const blur = { ...n, effects: [{ type: 'layer-blur' as const, radius: 10, visible: true }, { type: 'layer-blur' as const, radius: 10, visible: true }] };
    expect(inViewport(docOf(blur), blur, view, 1)).toBe(true);
    const frame = makeNode('frame', -200, 110); frame.w = 20;
    expect(inViewport(docOf(frame), frame, view, 1)).toBe(false);
    expect(inViewport(docOf(frame), frame, view, 1, 400)).toBe(true);
    expect(renderBounds(docOf(frame), frame, .5, 400).w).toBeGreaterThan(800);
});

it('keeps text glyph overhang outside layout bounds and respects parent world positions', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText: (s: string) => ({ width: s.length * 10, actualBoundingBoxLeft: 30, actualBoundingBoxRight: 80 }) }) }) });
    const frame = makeNode('frame', 100, 0), text = { ...makeNode('text', 20, 20), parent: frame.id, text: 'a' };
    expect(inViewport(docOf(frame, text), text, view, 1)).toBe(true);
});

it('keeps spread path shadows whose distant points scale beyond the original path bounds', () => {
    const path = { ...makeNode('path', 200, 300), w: 100, h: 100, closed: true, stroke: null, points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 10, y: 0, ix: 10, iy: 0, ox: 10, oy: 0 }, { x: 10, y: 1, ix: 10, iy: 1, ox: 10, oy: 1 }] };
    const effect = { type: 'drop-shadow' as const, x: 0, y: 0, blur: 0, spread: 10, color: '#000000', opacity: 1, visible: true };
    const viewport = { x: 1380, y: 340, w: 5, h: 5 };
    expect(inViewport(docOf(path), path, viewport, 1)).toBe(false);
    const shadow = { ...path, effects: [effect] };
    expect(inViewport(docOf(shadow), shadow, viewport, 1)).toBe(true);
    for (const change of [{ visible: false }, { spread: 0 }]) {
        const unchanged = { ...path, effects: [{ ...effect, ...change }] };
        expect(inViewport(docOf(unchanged), unchanged, viewport, 1)).toBe(false);
    }
});

it('avoids canvas work for culled nodes and preserves clipping before drawing frame descendants', () => {
    const operations: string[] = [];
    const c = new Proxy({ globalAlpha: 1, font: '11px system-ui', measureText: () => ({ width: 20 }) }, { get(target, key) { return key in target ? target[key as keyof typeof target] : () => operations.push(String(key)); }, set(target, key, value) { Reflect.set(target, key, value); return true; } }) as unknown as CanvasRenderingContext2D;
    const outside = makeNode('rect', 500, 500);
    drawNode(c, docOf(outside), outside, { zoom: 1, labels: false, viewport: view }); expect(operations).toEqual([]);
    const frame = makeNode('frame', 10, 10), child = { ...makeNode('rect', 0, 0), parent: frame.id };
    drawNode(c, docOf(frame, child), frame, { zoom: 1, labels: true, viewport: view });
    expect(operations.filter(op => op === 'roundRect')).toHaveLength(2);
    expect(operations.indexOf('clip')).toBeLessThan(operations.lastIndexOf('roundRect'));
    expect(operations).toContain('fillText');
    expect(operations.at(-1)).toBe('restore');
    operations.length = 0;
    drawNode(c, docOf(frame, child), frame, { zoom: 1, labels: true, viewport: view, skip: frame.id }); expect(operations).toEqual([]);
});

it('culls in rotated world space, including rotated parents and frame labels', () => {
    const node = { ...makeNode('rect', 110, 0), w: 20, h: 200, rotation: 90 };
    expect(inViewport(docOf(node), node, view, 1)).toBe(true);
    const parent = { ...makeNode('frame', 0, 0), w: 100, h: 100, rotation: 180 };
    const child = { ...makeNode('rect', 150, 0), w: 20, h: 20, parent: parent.id };
    expect(inViewport(docOf(parent, child), child, view, 1)).toBe(false);
    expect(inViewport(docOf(parent, child), child, { x: -80, y: 70, w: 40, h: 40 }, 1)).toBe(true);
    const frame = { ...makeNode('frame', 0, 110), w: 20, h: 20, rotation: 180 };
    expect(inViewport(docOf(frame), frame, { x: 0, y: 135, w: 10, h: 10 }, 1)).toBe(false);
    expect(inViewport(docOf(frame), frame, { x: 0, y: 135, w: 10, h: 10 }, 1, 40)).toBe(true);
});
