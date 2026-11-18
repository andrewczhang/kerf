import { afterEach, expect, it, vi } from 'vitest';
import { applyOp, makeNode, validNode, type Doc, type Effect, type Key, type Node, type Paint } from '../src/shared/doc';
import { corner } from '../src/shared/path';
import { drawNode } from '../src/client/draw';
import { exportBounds, exportSVG } from '../src/client/export';
import { editingPaint } from '../src/client/paint-edit';
import { gradientDown, gradientMove, gradientUp } from '../src/client/gradient-handles';
import { Store } from '../src/client/store';
import type { Context } from '../src/client/tools/tool';
import { textMask } from '../src/client/text-paint';

vi.mock('../src/client/text-layout', () => ({ font: () => '24px sans-serif', fontFamilies: { sans: 'sans-serif' }, measureTextNode: () => ({ lines: ['Painted'], w: 120, h: 30, leading: 30, baseline: 24, offset: 0 }), textPaintBounds: () => ({ x: -2, y: 0, w: 124, h: 30 }) }));
afterEach(() => vi.unstubAllGlobals());
const solid: Paint = { type: 'solid', color: '#123456', opacity: 1, visible: true }, gradient: Paint = { type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: [{ pos: 0, color: '#000000', opacity: 1 }, { pos: 1, color: '#ffffff', opacity: 1 }], opacity: 1, visible: true }, shadow: Effect = { type: 'drop-shadow', x: 4, y: 4, blur: 4, spread: 0, color: '#000000', opacity: .5, visible: true };
const path = (): Node => ({ ...makeNode('path', 20, 30), closed: true, points: [corner(0, 0), corner(1, 1), corner(0, 1)], fills: [solid, gradient], effects: [shadow], link: 'frame' });
const docOf = (n: Node): Doc => new Map([[n.id, n]]);
function context() {
    vi.stubGlobal('Path2D', class { moveTo = vi.fn(); bezierCurveTo = vi.fn(); closePath = vi.fn(); roundRect = vi.fn(); });
    return { canvas: { width: 500, height: 500 }, globalAlpha: 1, save: vi.fn(), restore: vi.fn(), translate: vi.fn(), fill: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })) };
}
it('validates and updates paint, path and prototype keys together', () => {
    const n = path(), doc = docOf(n); expect(validNode(n)).toBe(true);
    for (const [key, value] of Object.entries({ points: [corner(0, 0), corner(1, 0)], closed: false, link: null, fills: [], effects: [] })) applyOp(doc, { t: 'set', id: n.id, key: key as Key, value });
    expect(doc.get(n.id)).toMatchObject({ closed: false, link: null, fills: [], effects: [], points: [corner(0, 0), corner(1, 0)] });
    expect(validNode({ ...n, fills: [{ ...solid, color: 'invalid' }] })).toBe(false); expect(validNode({ ...n, points: [] })).toBe(false);
});
it('paints and shadows the traced path, not its bounding rectangle', () => {
    const n = path(), c = context(); drawNode(c as unknown as CanvasRenderingContext2D, docOf(n), n, { zoom: 1, labels: false, file: 'test' });
    expect(c.fill).toHaveBeenCalledTimes(3); const shape = c.fill.mock.calls[0][0]; expect(shape.bezierCurveTo).toHaveBeenCalled(); expect(shape.roundRect).not.toHaveBeenCalled(); expect(c.createLinearGradient).toHaveBeenCalledWith(20, 30, 120, 130);
});
it('skips all paint and effect work for hidden nodes and hidden ancestors', () => {
    const group = { ...makeNode('group', 0, 0), hidden: true }, n = { ...path(), parent: group.id }, doc: Doc = new Map<string, Node>([[group.id, group], [n.id, n]]), c = context();
    drawNode(c as unknown as CanvasRenderingContext2D, doc, group, { zoom: 1, labels: false }); drawNode(c as unknown as CanvasRenderingContext2D, doc, n, { zoom: 1, labels: false });
    expect(c.save).not.toHaveBeenCalled(); expect(c.fill).not.toHaveBeenCalled(); expect(exportSVG(doc, [n.id, group.id])).not.toContain('<path');
});
it('keeps group children paints and effect overflow while excluding hidden children', () => {
    const group = { ...makeNode('group', 0, 0), fills: [solid], effects: [shadow] }, n = { ...path(), parent: group.id }, hidden = { ...path(), id: 'hidden', parent: group.id, hidden: true, x: 1000 }, doc: Doc = new Map<string, Node>([[group.id, group], [n.id, n], [hidden.id, hidden]]), c = context();
    drawNode(c as unknown as CanvasRenderingContext2D, doc, group, { zoom: 1, labels: false, file: 'test' }); expect(c.fill).toHaveBeenCalledTimes(3);
    const svg = exportSVG(doc, [group.id]); expect(svg).toContain('<linearGradient'); expect(svg).toContain('<feOffset'); expect(svg).not.toContain('id="hidden"'); expect(exportBounds(doc, [group])).toEqual(exportBounds(doc, [n]));
});
it.each(['hidden', 'locked'] as const)('prevents gradient handles on a %s node or ancestor', key => {
    const group = makeNode('group', 0, 0), n = { ...path(), parent: group.id }, store = new Store(); store.doc.set(group.id, group); store.doc.set(n.id, n); store.selection.add(n.id); editingPaint.set(store, { id: n.id, index: 1 });
    const ctx = { store, viewport: { zoom: 1 }, invalidate() {} } as Context, before = structuredClone(n.fills);
    store.doc.set(n.id, { ...n, [key]: true }); expect(gradientDown(ctx, { x: 20, y: 30 })).toBe(false);
    store.doc.set(n.id, n); store.doc.set(group.id, { ...group, [key]: true }); expect(gradientDown(ctx, { x: 20, y: 30 })).toBe(false); expect(gradientMove(ctx, { x: 80, y: 80 })).toBe(false); expect(n.fills).toEqual(before);
});
it('keeps open paths stroke-only even with fills and skips empty closed-path shadows', () => {
    const n = { ...path(), closed: false }, c = context(); drawNode(c as unknown as CanvasRenderingContext2D, docOf(n), n, { zoom: 1, labels: false }); expect(c.fill).not.toHaveBeenCalled(); expect(c.stroke).toHaveBeenCalledTimes(2);
    const empty = { ...n, closed: true, fills: [], stroke: null }, blank = context(); drawNode(blank as unknown as CanvasRenderingContext2D, docOf(empty), empty, { zoom: 1, labels: false }); expect(blank.fill).not.toHaveBeenCalled(); expect(blank.translate).not.toHaveBeenCalled();
});
it('skips interior-clipped effects on open paths without closing their strokes', () => {
    const n = { ...path(), closed: false, effects: [{ type: 'background-blur' as const, radius: 10, visible: true }, { ...shadow, type: 'inner-shadow' as const }] }, c = context();
    drawNode(c as unknown as CanvasRenderingContext2D, docOf(n), n, { zoom: 1, labels: false });
    expect(c.stroke).toHaveBeenCalledTimes(1); expect(c.fill).not.toHaveBeenCalled(); expect(c.stroke.mock.calls[0][0].closePath).not.toHaveBeenCalled();
});
it('uses stacked text paints on glyphs and respects explicit empty fills', () => {
    const n = { ...makeNode('text', 0, 0), fills: [solid, gradient] }, c = context(); drawNode(c as unknown as CanvasRenderingContext2D, docOf(n), n, { zoom: 1, labels: false, file: 'test' }); expect(c.fillText).toHaveBeenCalledTimes(2); expect(c.fill).not.toHaveBeenCalled();
    const empty = { ...n, fills: [] }, blank = context(); drawNode(blank as unknown as CanvasRenderingContext2D, docOf(empty), empty, { zoom: 1, labels: false }); expect(blank.fillText).not.toHaveBeenCalled();
});
it('uses measured text geometry for gradient handle editing', () => {
    const n = { ...makeNode('text', 20, 30), fills: [gradient] }, store = new Store(); store.doc.set(n.id, n); store.selection.add(n.id); editingPaint.set(store, { id: n.id, index: 0 });
    const ctx = { store, viewport: { zoom: 1 }, invalidate() {} } as Context;
    expect(gradientDown(ctx, { x: 140, y: 60 })).toBe(true); expect(gradientMove(ctx, { x: 80, y: 45 })).toBe(true); expect(gradientUp(ctx)).toBe(true);
    expect(store.doc.get(n.id)?.fills?.[0]).toMatchObject({ to: { x: .5, y: .5 } });
});
it('pads glyph masks by transformed effect extent and retains offscreen glyph positions', () => {
    const n = { ...makeNode('text', -100, 20), effects: [{ ...shadow, x: 80, y: -20, blur: 4, spread: 2 }] }, c = { setTransform: vi.fn(), fillText: vi.fn() }, canvas = { width: 0, height: 0, getContext: () => c };
    vi.stubGlobal('document', { createElement: () => canvas });
    const target = { canvas: { width: 200, height: 100 }, getTransform: () => ({ a: 2, b: 0, c: 0, d: 2, e: 10, f: 20 }) } as unknown as CanvasRenderingContext2D;
    const mask = textMask(target, n, n);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(40_000); expect(mask.x).toBeLessThan(0); expect(c.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 10 - mask.x, 20 - mask.y); expect(c.fillText).toHaveBeenCalledWith('Painted', -100, 44);
});
it.each([0, 100, 10_000])('caps high-zoom glyph mask allocation with effect extent %s', blur => {
    const n = { ...makeNode('text', 0, 0), effects: [{ ...shadow, type: 'inner-shadow' as const, x: 100, y: 100, blur, spread: 100 }] }, canvas = { width: 0, height: 0, getContext: () => ({ setTransform: vi.fn(), fillText: vi.fn() }) };
    vi.stubGlobal('document', { createElement: () => canvas });
    const target = { canvas: { width: 2000, height: 1200 }, getTransform: () => ({ a: 16, b: 0, c: 0, d: 16, e: 0, f: 0 }) } as unknown as CanvasRenderingContext2D;
    textMask(target, n, n); expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000); expect(canvas.width).toBeGreaterThan(0); expect(canvas.height).toBeGreaterThan(0);
});
it('caps masks even when the visible glyph region alone exceeds the pixel budget', () => {
    const n = makeNode('text', 0, 0), c = { setTransform: vi.fn(), fillText: vi.fn() }, canvas = { width: 0, height: 0, getContext: () => c };
    vi.stubGlobal('document', { createElement: () => canvas });
    const target = { canvas: { width: 10_000, height: 10_000 }, getTransform: () => ({ a: 128, b: 0, c: 0, d: 128, e: 0, f: 0 }) } as unknown as CanvasRenderingContext2D;
    const mask = textMask(target, n, n); expect(canvas.width * canvas.height).toBeLessThanOrEqual(4_000_000); expect(mask.w).toBeGreaterThan(canvas.width); expect(mask.h).toBeGreaterThan(canvas.height);
});
it('exports painted paths and text with filters and retains text effect overflow', () => {
    const n = path(), svg = exportSVG(docOf(n), [n.id]); expect(svg).toContain('<path d="M20 30C'); expect(svg).toContain('gradientUnits="userSpaceOnUse"'); expect(svg).toContain('<feGaussianBlur');
    const open = { ...n, closed: false }, openSvg = exportSVG(docOf(open), [n.id]); expect(openSvg).not.toContain('<linearGradient'); expect(openSvg).toContain('fill="none" stroke=');
    const text = { ...makeNode('text', 0, 0), fills: [solid, gradient], effects: [shadow] }, textSvg = exportSVG(docOf(text), [text.id]); expect(textSvg).toContain('<text xml:space="preserve"'); expect(textSvg.match(/<tspan/g)).toHaveLength(2); expect(textSvg).toContain('<feOffset'); expect(exportBounds(docOf(text), [text])).toEqual({ x: -6, y: -4, w: 140, h: 46 });
    const empty = { ...text, fills: [], effects: [] }; expect(exportSVG(docOf(empty), [empty.id])).not.toContain('<text ');
});
