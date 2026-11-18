import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Doc, type Node, type Paint } from '../src/shared/doc';
import { inverse, multiply, transform, type Mat } from '../src/shared/geometry';
import { world, worldMatrix } from '../src/client/geometry';
import { drawNode } from '../src/client/draw';
import { exportBounds, exportSVG } from '../src/client/export';
import { gradientDown, drawGradientHandles } from '../src/client/gradient-handles';
import { editingPaint } from '../src/client/paint-edit';
import { Select } from '../src/client/tools/select';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';

afterEach(() => vi.unstubAllGlobals());
const solid: Paint = { type: 'solid', color: '#123456', opacity: 1, visible: true };
const gradient: Paint = { type: 'linear', from: { x: 0, y: .5 }, to: { x: 1, y: .5 }, stops: [{ pos: 0, color: '#000000', opacity: 1 }, { pos: 1, color: '#ffffff', opacity: 1 }], opacity: 1, visible: true };
const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
const correction = (doc: Doc, n: Node): Mat => { const m = worldMatrix(doc, n), r = world(doc, n); return [m[0], m[1], m[2], m[3], m[4] - m[0] * r.x - m[2] * r.y, m[5] - m[1] * r.x - m[3] * r.y]; };

it('composes painted frame and child transforms once and rotates shadow compensation', () => {
    vi.stubGlobal('Path2D', class { roundRect() {} });
    const frame = { ...makeNode('frame', 0, 0), rotation: 90, fills: [solid] }, child = { ...makeNode('rect', 10, 20), w: 40, h: 20, rotation: 30, parent: frame.id, fills: [solid], effects: [{ type: 'drop-shadow' as const, x: 5, y: 10, blur: 6, spread: 2, color: '#000000', opacity: 1, visible: true }] }, doc = docOf(frame, child);
    const offsets: { x: number; y: number }[] = [], c = { canvas: { width: 500, height: 500 }, globalAlpha: 1, shadowOffsetX: 0, shadowOffsetY: 0, save: vi.fn(), restore: vi.fn(), transform: vi.fn(), translate: vi.fn(), clip: vi.fn(), fill: () => offsets.push({ x: c.shadowOffsetX, y: c.shadowOffsetY }) };
    drawNode(c as unknown as CanvasRenderingContext2D, doc, frame, { zoom: 2, scale: 2, labels: false, file: 'test' });
    expect(c.transform.mock.calls).toEqual([correction(doc, frame), multiply(inverse(correction(doc, frame)), correction(doc, child))]);
    const shift = 1000 / 2 + 40 + 20 + 4 + 24, m = correction(doc, child);
    expect(offsets[1].x).toBeCloseTo((m[0] * (shift + 5) + m[2] * 10) * 2); expect(offsets[1].y).toBeCloseTo((m[1] * (shift + 5) + m[3] * 10) * 2);
});

it('exports rotated effects bounds and painted frame children without double rotation', () => {
    const n = { ...makeNode('rect', 100, 100), w: 100, h: 50, rotation: 90, fills: [solid], effects: [{ type: 'drop-shadow' as const, x: 5, y: 10, blur: 6, spread: 2, color: '#000000', opacity: 1, visible: true }, { type: 'layer-blur' as const, radius: 3, visible: true }] };
    expect(exportBounds(docOf(n), [n])).toEqual({ x: 92, y: 57, w: 96, h: 146 });
    const frame = { ...makeNode('frame', 0, 0), rotation: 90, fills: [solid] }, child = { ...makeNode('rect', 10, 20), rotation: 30, parent: frame.id, fills: [gradient] }, doc = docOf(frame, child), svg = exportSVG(doc, [frame.id]);
    expect(svg).toContain(`<g transform="matrix(${correction(doc, frame).join(' ')})">`);
    expect(svg).toContain(`<g transform="matrix(${multiply(inverse(correction(doc, frame)), correction(doc, child)).join(' ')})">`);
    expect(svg).toContain('<linearGradient'); expect(svg).toContain('clip-path="url(#clip-0)"');
});

it('draws and drags gradient endpoints in a rotated node under a rotated parent', () => {
    const store = new Store(), frame = { ...makeNode('frame', 0, 0), rotation: 45 }, n = { ...makeNode('rect', 10, 20), rotation: 30, parent: frame.id, fills: [gradient] };
    store.init([frame, n]); store.selection.add(n.id); editingPaint.set(store, { id: n.id, index: 0 });
    const ctx = { store, viewport: new Viewport(() => {}), invalidate() {} }, tool = new Select(ctx), m = worldMatrix(store.doc, n), start = transform(m, { x: 0, y: 50 }), end = transform(m, { x: 20, y: 10 });
    const c = { save() {}, restore() {}, beginPath() {}, moveTo: vi.fn(), lineTo: vi.fn(), stroke() {}, fillRect() {}, strokeRect() {} };
    drawGradientHandles(c as unknown as CanvasRenderingContext2D, ctx); expect(c.moveTo).toHaveBeenCalledWith(start.x, start.y);
    expect(gradientDown(ctx, { x: -999, y: -999 })).toBe(false); tool.onPointerDown(start, {} as PointerEvent); expect(tool.original.size).toBe(0);
    tool.onPointerMove(end, {} as PointerEvent); tool.onPointerUp(end);
    const paint = store.doc.get(n.id)!.fills![0]; expect(paint.type).toBe('linear'); if (paint.type !== 'linear') throw Error('Expected gradient');
    expect(paint.from.x).toBeCloseTo(.2); expect(paint.from.y).toBeCloseTo(.1); expect(store.undoStack).toHaveLength(1);
    store.history(); expect(store.doc.get(n.id)!.fills).toEqual([gradient]);
});
