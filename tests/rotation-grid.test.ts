import { expect, it, vi } from 'vitest';
import { makeNode, type LayoutGrid } from '../src/shared/doc';
import { aabb, transform, worldMatrix } from '../src/shared/geometry';
import { inspectCSS } from '../src/shared/inspect';
import { drawLayoutGrids } from '../src/client/layout-grids';
import { snapped } from '../src/client/snapping';
import { Store } from '../src/client/store';
import { Shape } from '../src/client/tools/shape';
import type { Context } from '../src/client/tools/tool';

const grid: LayoutGrid = { type: 'columns', count: 2, size: 20, gutter: 20, margin: 20, color: '#ff0000', opacity: .1, visible: true };

it('draws local grid bands through composed matrices and clips each rotated ancestor', () => {
    const parent = { ...makeNode('frame', 100, 100), rotation: 30 }, frame = { ...makeNode('frame', 20, 30), parent: parent.id, rotation: 60, grids: [grid] }, doc = new Map([[parent.id, parent], [frame.id, frame]]);
    const c = { save() {}, restore() {}, transform: vi.fn(), beginPath() {}, roundRect: vi.fn(), clip: vi.fn(), fillRect: vi.fn() };
    drawLayoutGrids(c as unknown as CanvasRenderingContext2D, doc, 1);
    expect(c.transform.mock.calls).toEqual([worldMatrix(doc, frame), worldMatrix(doc, parent), worldMatrix(doc, frame)]);
    expect(c.roundRect.mock.calls).toEqual([[0, 0, 100, 100, 0], [0, 0, 100, 100, 0]]);
    expect(c.fillRect.mock.calls).toEqual([[20, 0, 20, 100], [60, 0, 20, 100]]);
    c.fillRect.mockClear(); doc.set(parent.id, { ...parent, hidden: true });
    drawLayoutGrids(c as unknown as CanvasRenderingContext2D, doc, 1); expect(c.fillRect).not.toHaveBeenCalled();
    drawLayoutGrids(c as unknown as CanvasRenderingContext2D, new Map(), 1); expect(c.fillRect).not.toHaveBeenCalled();
});

it('snaps rotated column lines on the matching world axis without inventing diagonal guides', () => {
    const store = new Store(), frame = { ...makeNode('frame', 100, 100), w: 400, h: 300, rotation: 90, grids: [grid] };
    store.init([frame]);
    const ctx = { store, viewport: { zoom: 1 }, invalidate() {}, snap: { guides: [], measure: [], rulers: false, grid: false, lines: [] } } as unknown as Context;
    expect(snapped(ctx, { x: 200, y: 72, w: 7, h: 7 }, {} as PointerEvent).y).toBeCloseTo(70);
    expect(ctx.snap!.guides.some(g => g.axis === 'y' && Math.abs(g.position - 70) < 1e-7)).toBe(true);
    store.set(frame.id, { rotation: 45 }); const box = aabb(store.doc, store.doc.get(frame.id)!), moving = { x: Math.round(box.x) + 22, y: Math.round(box.y) + 50, w: 7, h: 7 };
    expect(snapped(ctx, moving, {} as PointerEvent)).toEqual(moving);
});

it('includes a centered CSS rotation while leaving legacy CSS unchanged', () => {
    const n = makeNode('rect', 10, 20);
    expect(inspectCSS({ ...n, rotation: 45 })).toContain('transform: rotate(45deg);');
    expect(inspectCSS({ ...n, rotation: undefined })).not.toContain('transform:');
});

it('ignores unpressed shape movement while preserving local-axis drawing in a rotated frame', () => {
    const store = new Store(), frame = { ...makeNode('frame', 100, 100), rotation: 90 };
    store.init([frame]); const ctx = { store, viewport: { zoom: 1 }, invalidate() {} } as Context, tool = new Shape(ctx, 'rect', () => {}), m = worldMatrix(store.doc, frame);
    tool.onPointerDown(transform(m, { x: 10, y: 10 })); const id = tool.node!.id;
    tool.onPointerMove(transform(m, { x: 40, y: 50 }), { buttons: 0 } as PointerEvent); expect(store.doc.get(id)?.w).toBe(100);
    tool.onPointerMove(transform(m, { x: 40, y: 50 }), { buttons: 1 } as PointerEvent); tool.onPointerUp();
    expect(store.doc.get(id)).toMatchObject({ x: 10, y: 10, w: 30, h: 40, parent: frame.id });
});
