import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Doc, type Node, type Paint } from '../src/shared/doc';
import { hit, inverse, multiply, transform, type Mat } from '../src/shared/geometry';
import { corner } from '../src/shared/path';
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

it.each(['rect', 'ellipse'] as const)('hit-tests a rotated %s outside stroke in local space', type => {
    const n = { ...makeNode(type, 100, 100), w: 100, h: 50, rotation: 90, stroke: '#000000', strokeWidth: 10, strokeAlign: 'outside' as const }, doc = docOf(n), m = worldMatrix(doc, n);
    expect(hit(doc, transform(m, { x: 50, y: -8 }))?.id).toBe(n.id);
    expect(hit(doc, transform(m, { x: 50, y: -12 }))).toBeUndefined();
    expect(exportBounds(doc, [n])).toEqual({ x: 115, y: 65, w: 70, h: 120 });
});

it('hit-tests and exports rotated arrowheads with their stroke and dash geometry', () => {
    const n = { ...makeNode('path', 0, 0), rotation: 90, points: [corner(0, .5), corner(1, .5)], stroke: '#000000', strokeWidth: 8, strokeEnd: 'bar' as const, strokeDash: 6, strokeGap: 4 }, doc = docOf(n), m = worldMatrix(doc, n);
    expect(hit(doc, transform(m, { x: 100, y: 62 }))?.id).toBe(n.id);
    expect(hit(doc, transform(m, { x: 120, y: 90 }))).toBeUndefined();
    const svg = exportSVG(doc, [n.id]); expect(svg).toContain(`<g transform="matrix(${correction(doc, n).join(' ')})">`); expect(svg).toContain('stroke-dasharray="6 4"');
});

it('rasterizes an outside stroke shadow with rotated bounds, silhouette and offsets', () => {
    vi.stubGlobal('Path2D', class { roundRect() {} rect() {} addPath() {} });
    const n = { ...makeNode('rect', 0, 0), w: 100, h: 50, rotation: 90, fills: [], stroke: '#000000', strokeWidth: 8, strokeAlign: 'outside' as const, effects: [{ type: 'drop-shadow' as const, x: 10, y: 14, blur: 2, spread: 0, color: '#000000', opacity: 1, visible: true }] }, doc = docOf(n), m = correction(doc, n);
    const context = () => ({ save() {}, restore() {}, transform() {}, translate() {}, setTransform: vi.fn(), clip() {}, stroke() {}, drawImage: vi.fn(), globalAlpha: 1 });
    const caster = context(), buffer = { width: 0, height: 0, getContext: () => caster }, target = { ...context(), canvas: { width: 500, height: 500 }, getTransform: () => ({ e: m[4], f: m[5] }), shadowOffsetY: 0 };
    vi.stubGlobal('document', { createElement: () => buffer });
    drawNode(target as unknown as CanvasRenderingContext2D, doc, n, { zoom: 1, labels: false });
    const matrix = caster.setTransform.mock.calls[0]; expect(matrix[0]).toBeCloseTo(0); expect(matrix[1]).toBeCloseTo(1); expect(matrix[2]).toBeCloseTo(-1); expect(matrix[3]).toBeCloseTo(0);
    expect(target.shadowOffsetY).toBeCloseTo(10); expect(target.drawImage).toHaveBeenCalledOnce();
});
