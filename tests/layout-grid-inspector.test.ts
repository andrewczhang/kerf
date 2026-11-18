import { expect, it } from 'vitest';
import { editLayoutGrid, refreshLayoutGridFields } from '../src/client/ui/layout-grids';
import { Store } from '../src/client/store';
import { makeNode } from '../src/shared/doc';
import { defaultLayoutGrid } from '../src/shared/layout-grid';

function setup() {
    const store = new Store();
    const grid = { ...defaultLayoutGrid(1200), count: 6, gutter: 36 };
    const frame = { ...makeNode('frame', 0, 0), w: 1200, grids: [grid] };
    store.init([frame]);
    const field = (key: string, value: string, type = 'number') => ({ dataset: { gridNode: frame.id, gridIndex: '0', gridKey: key }, type, value, checked: true, disabled: false }) as unknown as HTMLInputElement;
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
    editLayoutGrid(store, frame.id, 0, 'count', 7);
    expect(store.doc.get(frame.id)?.grids?.[0]).toEqual({ ...grid, count: 7, gutter: 50, visible: false, type: 'rows' });
    store.history();
    expect(store.doc.get(frame.id)?.grids?.[0]).toEqual({ ...grid, gutter: 50, visible: false, type: 'rows' });
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
