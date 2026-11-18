import { it, expect, vi } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { world } from '../src/shared/geometry';
import { Store } from '../src/client/store';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';
import { aabb } from '../src/client/geometry';
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

it('resizes grouped auto-width text around its measured center without a persistent jump', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText: (line: string) => ({ width: line.length * 10 }) }) }) });
    try {
        const { store, tool } = setup(), g = { ...makeNode('group', 100, 100), w: 200, h: 100 }, rect = { ...makeNode('rect', 0, 0), w: 200, h: 100, parent: g.id }, text = { ...makeNode('text', 20, 20), parent: g.id };
        store.init([g, rect, text]); store.selection.add(g.id);
        const before = aabb(store.doc, text), start = tool.selectionHandles()[4], end = { x: start.x + 200, y: start.y + 100 }, event = { timeStamp: 1000 } as PointerEvent;
        expect(before.w).toBe(40); expect(text.w).toBe(240);
        tool.onPointerDown(start, event); tool.onPointerMove(end, event);
        const expected = { x: 180, y: 168.8 };
        const check = () => { const r = aabb(store.doc, store.doc.get(text.id)!); expect(r.x + r.w / 2).toBeCloseTo(expected.x); expect(r.y + r.h / 2).toBeCloseTo(expected.y); expect(r.w).toBeCloseTo(before.w); expect(r.h).toBeCloseTo(before.h); };
        check(); tool.onPointerUp(end); check(); expect(store.undoStack).toHaveLength(1);
        store.history(); expect(aabb(store.doc, store.doc.get(text.id)!)).toEqual(before); store.history(true); check();
    } finally { vi.unstubAllGlobals(); }
});
