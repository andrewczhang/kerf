import { expect, it, vi } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { corner } from '../src/shared/path';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import { Pen } from '../src/client/tools/pen';

const setup = () => {
    const store = new Store(), exit = vi.fn(), pen = new Pen({ store, viewport: new Viewport(() => {}), invalidate() {} }, exit);
    const node = { ...makeNode('path', 10, 20), points: [corner(0, 0), corner(1, 1)] };
    store.init([node]); store.selection.add(node.id); return { store, pen, node, exit };
};
it('allows deleting an editable selected path and handles missing selection', () => {
    const { store, pen, node } = setup(); expect(pen.path()?.id).toBe(node.id);
    pen.onKey({ key: 'Delete', preventDefault() {} } as KeyboardEvent); expect(store.doc.has(node.id)).toBe(false); expect(pen.path()).toBeUndefined();
});
it('ignores hidden and locked selected paths and their hidden or locked ancestors', () => {
    for (const key of ['hidden', 'locked'] as const) for (const ancestor of [false, true]) {
        const { store, pen, node } = setup(), group = { ...makeNode('group', 0, 0), [key]: true };
        store.init(ancestor ? [group, { ...node, parent: group.id }] : [{ ...node, [key]: true }]);
        const before = new Map(store.doc); expect(pen.path()).toBeUndefined();
        for (const key of ['Enter', 'Delete', 'Backspace']) pen.onKey({ key, preventDefault() {} } as KeyboardEvent);
        expect(store.doc).toEqual(before); expect(store.undoStack).toHaveLength(0);
    }
});
it('stops an in-progress anchor drag if the path is locked remotely', () => {
    const { store, pen, node } = setup();
    pen.onPointerDown({ x: 10, y: 20 }, { shiftKey: false } as PointerEvent);
    store.remote([{ t: 'set', id: node.id, key: 'locked', value: true }]); const before = new Map(store.doc);
    pen.onPointerMove({ x: 50, y: 60 }, { buttons: 1 } as PointerEvent); pen.onPointerUp();
    expect(store.doc).toEqual(before);
});
