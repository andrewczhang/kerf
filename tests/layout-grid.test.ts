import { afterEach, expect, it, vi } from 'vitest';
import { applyOp, makeNode, validNode, type LayoutGrid } from '../src/shared/doc';
import { defaultLayoutGrid, gridBands, gridLines } from '../src/shared/layout-grid';
import { resizeSnap, snapRect } from '../src/shared/snap';
import { Store } from '../src/client/store';
import { snapped } from '../src/client/snapping';
import type { Context } from '../src/client/tools/tool';
import { expand, instanceNode } from '../src/shared/components';
import { layoutGridsSection } from '../src/client/ui/layout-grids';

afterEach(() => vi.unstubAllGlobals());
class GridElement {
    children: GridElement[] = [];
    attributes: Record<string, string> = {};
    textContent = '';
    value = '';
    min = '';
    max = '';
    onclick?: () => void;
    onchange?: () => void;
    constructor(text = '', value = '') { this.textContent = text; this.value = value; }
    set innerHTML(_value: string) { this.children = []; }
    append(...nodes: GridElement[]) { this.children.push(...nodes); }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    checkValidity() { return Number.isFinite(Number(this.value)) && (!this.min || +this.value >= +this.min) && (!this.max || +this.value <= +this.max); }
    all(): GridElement[] { return [this, ...this.children.flatMap(n => n.all())]; }
}

const grid: LayoutGrid = { type: 'columns', count: 12, size: 20, gutter: 20, margin: 24, color: '#ff0000', opacity: .1, visible: true };
const rect = { x: 100, y: 50, w: 1200, h: 800 };
it('lists and edits inherited grids without changing the main and retains newly added grids', () => {
    vi.stubGlobal('document', { createElement: () => new GridElement() }); vi.stubGlobal('Option', GridElement);
    const store = new Store(), main = { ...makeNode('frame', 0, 0), component: true, grids: [grid] }, instance = instanceNode(main, 200, 0);
    store.init([main, instance]);
    const content = new GridElement(); layoutGridsSection(content as unknown as HTMLElement, store, instance);
    const find = (label: string) => content.all().find(n => n.attributes['aria-label'] === label)!;
    expect(find('Grid count').value).toBe('12');
    find('Grid count').value = '0'; find('Grid count').onchange!();
    expect(store.undoStack).toHaveLength(0);
    find('Grid count').value = '6'; find('Grid count').onchange!();
    expect(find('Grid count').value).toBe('6'); expect(store.doc.get(main.id)?.grids).toEqual([grid]);
    find('Add layout grid').onclick!();
    expect(content.all().filter(n => n.attributes['aria-label'] === 'Grid count')).toHaveLength(2);
    expect(expand(store.doc).get(instance.id)?.grids).toHaveLength(2);
    content.all().find(n => n.textContent === 'Remove')!.onclick!();
    expect(expand(store.doc).get(instance.id)?.grids).toHaveLength(1);
    store.history(); store.history(); store.history();
    expect(expand(store.doc).get(instance.id)?.grids).toEqual([grid]);
    store.set(instance.id, { grids: [] });
    const empty = new GridElement(); layoutGridsSection(empty as unknown as HTMLElement, store, instance);
    expect(empty.all().some(n => n.attributes['aria-label'] === 'Grid count')).toBe(false);
    expect(store.doc.get(main.id)?.grids).toEqual([grid]);
});
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
        expect(ctx.snap!.guides.filter(g => g.axis === 'x')).toEqual([]);
    }
});
it('ignores grid candidates clipped by ancestor frames', () => {
    const store = new Store(), outer = { ...makeNode('frame', 0, 0), w: 150, h: 150 };
    const frame = { ...makeNode('frame', 100, 0), w: 400, h: 400, parent: outer.id, grids: [{ ...grid, type: 'grid' as const }] };
    store.init([outer, frame]);
    const ctx = { store, viewport: { zoom: 1 }, invalidate() {}, snap: { guides: [], measure: [], rulers: false, grid: false, lines: [] } } as unknown as Context;
    const moving = { x: 118, y: 38, w: 7, h: 7 };
    expect(snapped(ctx, moving, {} as PointerEvent, { x: 0 }).x).toBe(120);
    expect(snapped(ctx, { ...moving, x: 178 }, {} as PointerEvent).x).toBe(178);
    expect(snapped(ctx, { ...moving, y: 178 }, {} as PointerEvent).y).toBe(178);
    expect(snapped(ctx, { ...moving, x: 145, w: 13 }, {} as PointerEvent).x).not.toBe(147);
});
