import { expect, it } from 'vitest';
import { applyOp, makeNode, validNode, type LayoutGrid } from '../src/shared/doc';
import { defaultLayoutGrid, gridBands, gridLines } from '../src/shared/layout-grid';
import { resizeSnap, snapRect } from '../src/shared/snap';
import { Store } from '../src/client/store';
import { snapped } from '../src/client/snapping';
import type { Context } from '../src/client/tools/tool';

const grid: LayoutGrid = { type: 'columns', count: 12, size: 20, gutter: 20, margin: 24, color: '#ff0000', opacity: .1, visible: true };
const rect = { x: 100, y: 50, w: 1200, h: 800 };
it('creates visible default columns even for the smallest valid frames', () => {
    for (const w of [1, 10, 100, 267, 268, 1200]) {
        const g = defaultLayoutGrid(w), bands = gridBands({ ...rect, w }, g);
        expect(bands).toHaveLength(12);
        expect(bands.every(b => b.w > 0 && b.x >= rect.x && b.x + b.w <= rect.x + w)).toBe(true);
        expect(validNode({ ...makeNode('frame', 0, 0), w, grids: [g] })).toBe(true);
    }
    expect(defaultLayoutGrid(1200)).toEqual(gridWithDefaultColor());
});
function gridWithDefaultColor() { return { ...grid, color: '#ff4f00' }; }
it('stretches columns and rows in world coordinates', () => {
    const bands = gridBands(rect, grid);
    expect(bands).toHaveLength(12); expect(bands[0]).toEqual({ x: 124, y: 50, w: 932 / 12, h: 800 });
    expect(bands.at(-1)!.x + bands.at(-1)!.w).toBeCloseTo(1276);
    const rows = gridBands(rect, { ...grid, type: 'rows', count: 2 });
    expect(rows[0]).toEqual({ x: 100, y: 74, w: 1200, h: 366 });
    expect(gridLines(rect, grid)).toHaveLength(24);
});
it('handles empty bands and square grid lines', () => {
    expect(gridBands(rect, { ...grid, margin: 900 })).toEqual([]);
    expect(gridBands(rect, { ...grid, type: 'grid' })).toEqual([]);
    expect(gridLines({ x: 10, y: 20, w: 40, h: 20 }, { ...grid, type: 'grid' })).toEqual([
        { axis: 'x', position: 10 }, { axis: 'x', position: 30 }, { axis: 'x', position: 50 }, { axis: 'y', position: 20 }, { axis: 'y', position: 40 },
    ]);
    expect(gridLines(rect, { ...grid, type: 'grid', size: 0 })).toEqual([]);
});
it('validates grids strictly and restricts them to frames', () => {
    const frame = { ...makeNode('frame', 0, 0), grids: [grid] };
    expect(validNode(frame)).toBe(true); expect(validNode({ ...frame, grids: [] })).toBe(true);
    expect(validNode({ ...frame, type: 'rect' })).toBe(false);
    expect(validNode({ ...frame, grids: Array(9).fill(grid) })).toBe(false);
    for (const bad of [{ count: 0 }, { count: 101 }, { count: 1.5 }, { size: 0 }, { size: Infinity }, { gutter: -1 }, { margin: NaN }, { color: 'red' }, { opacity: 2 }, { visible: 1 }, { type: 'bad' }])
        expect(validNode({ ...frame, grids: [{ ...grid, ...bad } as LayoutGrid] })).toBe(false);
    const doc = new Map([[frame.id, frame]]);
    applyOp(doc, { t: 'set', id: frame.id, key: 'grids', value: [] }); expect(doc.get(frame.id)?.grids).toEqual([]);
    applyOp(doc, { t: 'set', id: frame.id, key: 'grids', value: [{ ...grid, count: 0 }] }); expect(doc.get(frame.id)?.grids).toEqual([]);
});
it('bounds square grid size and skips overly dense axes at the current zoom', () => {
    const square = { ...grid, type: 'grid' as const, size: 2 };
    for (const size of [2, 10000]) expect(validNode({ ...makeNode('frame', 0, 0), grids: [{ ...square, size }] })).toBe(true);
    for (const size of [1.99, 10001]) {
        expect(validNode({ ...makeNode('frame', 0, 0), grids: [{ ...square, size }] })).toBe(false);
        expect(gridLines(rect, { ...square, size })).toEqual([]);
    }
    expect(gridLines({ ...rect, w: 1998, h: 1998 }, square)).toHaveLength(2000);
    const lines = gridLines({ ...rect, w: 1e300, h: 20 }, square);
    expect(lines).toHaveLength(11); expect(lines.every(l => l.axis === 'y')).toBe(true);
    expect(gridLines(rect, square, .5)).toEqual([]);
    expect(gridLines(rect, square, 1)).toHaveLength(1002);
    expect(gridLines(rect, square, 0)).toEqual([]);
});
it('snaps moves and resizes to column edges with guides', () => {
    const lines = gridLines(rect, grid), moving = { x: 122, y: 80, w: 30, h: 20 };
    expect(snapRect(moving, [], 6, false, lines).dx).toBe(2);
    expect(snapRect(moving, [], 6, false, lines).guides[0].position).toBe(124);
    expect(resizeSnap({ ...moving, x: 90, w: 32 }, [], 6, { x: 1 }, false, lines).rect.w).toBe(34);
    expect(snapRect({ ...moving, x: 140 }, [], 2, false, lines).guides).toEqual([]);
});
it('keeps grid edits undoable and serializable', () => {
    const store = new Store(), frame = makeNode('frame', 0, 0);
    store.commit([{ t: 'create', node: frame }]); store.set(frame.id, { grids: [grid] });
    expect(JSON.parse(JSON.stringify([...store.doc.values()]))[0].grids).toEqual([grid]);
    store.history(); expect(store.doc.get(frame.id)?.grids).toBeUndefined();
    store.history(true); expect(store.doc.get(frame.id)?.grids).toEqual([grid]);
});
it('uses containing visible frame grids and respects hidden grids and snap modifiers', () => {
    const store = new Store(), frame = { ...makeNode('frame', rect.x, rect.y), ...rect, grids: [grid] };
    store.init([frame]);
    const ctx = { store, viewport: { zoom: 1 }, invalidate() {}, snap: { guides: [], measure: [], rulers: false, grid: false, lines: [] } } as unknown as Context;
    const moving = { x: 122, y: 80, w: 30, h: 20 }, event = {} as PointerEvent;
    expect(snapped(ctx, moving, event).x).toBe(124);
    expect(snapped(ctx, moving, { ctrlKey: true } as PointerEvent)).toEqual(moving);
    ctx.snap!.layoutGrids = false; expect(snapped(ctx, moving, event).x).toBe(122);
    ctx.snap!.layoutGrids = true;
    store.set(frame.id, { grids: [{ ...grid, visible: false }] }); expect(snapped(ctx, moving, event).x).toBe(122);
    expect(snapped(ctx, { ...moving, y: -200 }, event).x).toBe(122);
});
it('excludes grids on selected frames and descendants of selected groups', () => {
    const store = new Store(), group = makeNode('group', 0, 0);
    const frame = { ...makeNode('frame', 100, 50), ...rect, parent: group.id, grids: [grid] };
    store.init([group, frame]);
    const ctx = { store, viewport: { zoom: 1 }, invalidate() {}, snap: { guides: [], measure: [], rulers: false, grid: false, lines: [] } } as unknown as Context;
    const moving = { x: 122, y: 80, w: 30, h: 20 };
    expect(snapped(ctx, moving, {} as PointerEvent).x).toBe(124);
    for (const id of [frame.id, group.id]) {
        store.selection = new Set([id]);
        expect(snapped(ctx, moving, {} as PointerEvent).x).toBe(122);
        expect(ctx.snap!.guides).toEqual([]);
    }
});
