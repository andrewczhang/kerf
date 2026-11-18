import { it, expect } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { world } from '../src/shared/geometry';
import { Store } from '../src/client/store';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';
const key = (tool: Select, key: string, extra = {}) => tool.onKey({ key, preventDefault() {}, ...extra } as KeyboardEvent);
const setup = () => { const store = new Store(), tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }); return { store, tool }; };
it('groups, nudges an inner node with normalized bounds and ungroups in single undo steps', () => {
    const { store, tool } = setup(), a = makeNode('rect', 20, 30), b = { ...makeNode('ellipse', 200, 50), index: 'z' }; store.init([a, b]); store.selection.add(a.id); store.selection.add(b.id);
    key(tool, 'g', { ctrlKey: true }); const g = store.doc.get([...store.selection][0])!; expect(g.type).toBe('group'); expect(store.undoStack).toHaveLength(1);
    store.selection.clear(); store.selection.add(a.id); key(tool, 'ArrowLeft'); expect(world(store.doc, store.doc.get(a.id)!).x).toBe(19); expect(store.doc.get(g.id)?.x).toBe(19); expect(world(store.doc, store.doc.get(b.id)!).x).toBe(200);
    store.selection.clear(); store.selection.add(g.id); key(tool, 'G', { ctrlKey: true, shiftKey: true }); expect(store.doc.has(g.id)).toBe(false); expect([...store.selection]).toEqual([a.id, b.id]); expect(store.undoStack).toHaveLength(3);
    store.history(); expect(store.doc.get(a.id)?.parent).toBe(g.id);
});
it('does not nudge or delete a locked node selected from layers, including locked ancestry', () => {
    const { store, tool } = setup(), g = { ...makeNode('group', 0, 0), locked: true }, a = { ...makeNode('rect', 10, 20), parent: g.id }; store.init([g, a]); store.selection.add(a.id);
    key(tool, 'ArrowRight'); key(tool, 'Delete'); expect(store.doc.get(a.id)?.x).toBe(10); expect(store.doc.has(a.id)).toBe(true);
});
it('handles empty grouping, ungrouping, nudge and delete selections', () => {
    const { store, tool } = setup(); key(tool, 'g', { ctrlKey: true }); key(tool, 'G', { ctrlKey: true, shiftKey: true }); key(tool, 'ArrowRight'); key(tool, 'Delete'); expect(store.doc.size).toBe(0); expect(store.undoStack).toHaveLength(0);
});
