import { expect, it } from 'vitest';
import { editLayoutGrid, refreshLayoutGridFields, removeLayoutGrid } from '../src/client/ui/layout-grids';
import { Store } from '../src/client/store';
import { makeNode, validNode } from '../src/shared/doc';
import { defaultLayoutGrid } from '../src/shared/layout-grid';

function setup() {
    const store = new Store();
    const grid = { ...defaultLayoutGrid(1200), count: 6, gutter: 36 };
    const frame = { ...makeNode('frame', 0, 0), w: 1200, grids: [grid] };
    store.init([frame]);
    const field = (key: string, value: string, type = 'number') => ({ dataset: { gridNode: frame.id, gridIndex: '0', gridId: grid.id, gridKey: key }, type, value, checked: true, disabled: false }) as unknown as HTMLInputElement;
    const count = field('count', '06'), gutter = field('gutter', '36'), visible = field('visible', '', 'checkbox'), type = field('type', 'columns', 'select-one');
    const content = { querySelectorAll: () => [count, gutter, visible, type] } as unknown as HTMLElement;
    return { store, frame, grid, count, gutter, visible, type, content };
}

it('refreshes remote grid edits without replacing the focused draft, then merges only the local edited field', () => {
    const { store, frame, grid, count, gutter, visible, type, content } = setup();
    store.addEventListener('change', () => refreshLayoutGridFields(content, store, count));
    store.remote([{ t: 'set', id: frame.id, key: 'grids', value: [{ ...grid, gutter: 50, visible: false, type: 'rows' }] }]);
    expect(count.value).toBe('06');
    expect(gutter.value).toBe('50'); expect(visible.checked).toBe(false); expect(type.value).toBe('rows');
    editLayoutGrid(store, frame.id, grid.id!, 'count', 7);
    expect(store.doc.get(frame.id)?.grids?.[0]).toEqual({ ...grid, count: 7, gutter: 50, visible: false, type: 'rows' });
    store.history();
    expect(store.doc.get(frame.id)?.grids?.[0]).toEqual({ ...grid, gutter: 50, visible: false, type: 'rows' });
});

it('tracks grid identity after a peer removes an earlier grid and disables a removed target', () => {
    const { store, frame, grid, count, gutter, content } = setup();
    const earlier = defaultLayoutGrid(1200), later = defaultLayoutGrid(1200);
    store.init([{ ...frame, grids: [earlier, grid, later] }]);
    count.dataset.gridIndex = gutter.dataset.gridIndex = '1';
    store.remote([{ t: 'set', id: frame.id, key: 'grids', value: [grid, later] }]);
    editLayoutGrid(store, frame.id, grid.id!, 'count', 7);
    expect(store.doc.get(frame.id)?.grids).toEqual([{ ...grid, count: 7 }, later]);
    store.pending.clear();
    store.remote([{ t: 'set', id: frame.id, key: 'grids', value: [later] }]);
    refreshLayoutGridFields(content, store, count);
    expect(count.disabled).toBe(true); expect(gutter.disabled).toBe(true);
    editLayoutGrid(store, frame.id, grid.id!, 'count', 9);
    removeLayoutGrid(store, frame.id, grid.id!);
    expect(store.doc.get(frame.id)?.grids).toEqual([later]);
    store.remote([{ t: 'set', id: frame.id, key: 'grids', value: [later, grid] }]);
    removeLayoutGrid(store, frame.id, grid.id!);
    expect(store.doc.get(frame.id)?.grids).toEqual([later]);
});

it('validates short ids, assigns unique default ids and supports legacy index edits', () => {
    const { store, frame, grid } = setup();
    expect(defaultLayoutGrid(1200).id).not.toBe(grid.id);
    for (const id of ['', 'x'.repeat(65), 42]) expect(validNode({ ...frame, grids: [{ ...grid, id } as typeof grid] })).toBe(false);
    const legacy = { ...grid, id: undefined };
    expect(validNode({ ...frame, grids: [legacy] })).toBe(true);
    store.init([{ ...frame, grids: [legacy] }]);
    editLayoutGrid(store, frame.id, 0, 'count', 8);
    expect(store.doc.get(frame.id)?.grids?.[0].count).toBe(8);
    removeLayoutGrid(store, frame.id, 0);
    expect(store.doc.get(frame.id)?.grids).toEqual([]);
});

it('does not resurrect grids removed remotely or edit missing nodes', () => {
    const { store, frame, count, gutter, content } = setup();
    store.remote([{ t: 'set', id: frame.id, key: 'grids', value: [] }]);
    refreshLayoutGridFields(content, store, count);
    expect(gutter.disabled).toBe(true); expect(count.value).toBe('06');
    editLayoutGrid(store, frame.id, 0, 'count', 7);
    editLayoutGrid(store, 'missing', 0, 'count', 7);
    expect(store.doc.get(frame.id)?.grids).toEqual([]);
    expect(store.undoStack).toHaveLength(0);
});
