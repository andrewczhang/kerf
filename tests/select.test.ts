import { it, expect, vi } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { transform, world } from '../src/shared/geometry';
import { Store } from '../src/client/store';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';
import { aabb, worldMatrix } from '../src/client/geometry';
const key = (tool: Select, key: string, extra = {}) => tool.onKey({ key, preventDefault() {}, ...extra } as KeyboardEvent);
const setup = () => { const store = new Store(), tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }); return { store, tool }; };
it('selects selectable top-level objects with Ctrl/Cmd+A, including an empty canvas', () => {
    const { store, tool } = setup(); key(tool, 'a', { ctrlKey: true }); expect(store.selection.size).toBe(0);
    const frame = makeNode('frame', 0, 0), child = { ...makeNode('rect', 0, 0), parent: frame.id }, hidden = { ...makeNode('rect', 0, 0), hidden: true };
    store.init([frame, child, hidden]); let prevented = false;
    key(tool, 'A', { metaKey: true, preventDefault() { prevented = true; } });
    expect(prevented).toBe(true); expect([...store.selection]).toEqual([frame.id]);
});
it('keeps overlapping sibling frames as siblings but allows fully contained drops', () => {
    const { store, tool } = setup(), a = makeNode('frame', 50, 0), b = makeNode('frame', 100, 0);
    store.init([a, b]); tool.original.set(a.id, a); tool.moved = true;
    tool.onPointerUp({ x: 125, y: 50 }); expect(store.doc.get(a.id)?.parent).toBe(null);
    store.set(b.id, { x: 0, w: 300, h: 300 }); tool.onPointerUp({ x: 125, y: 50 });
    expect(store.doc.get(a.id)?.parent).toBe(b.id);
});
it('never reparents into another dragged frame or its descendants', () => {
    const { store, tool } = setup(), a = makeNode('frame', 50, 0), b = { ...makeNode('frame', 0, 0), w: 300, h: 300 }, child = { ...makeNode('frame', 0, 0), parent: b.id, w: 250, h: 250 };
    store.init([a, b, child]); tool.original.set(a.id, a); tool.original.set(b.id, b); tool.moved = true;
    tool.onPointerUp({ x: 125, y: 50 });
    expect(store.doc.get(a.id)?.parent).toBe(null); expect(store.doc.get(b.id)?.parent).toBe(null);
    expect(store.doc.get(child.id)?.parent).toBe(b.id);
});
it('keeps a shape in its current parent when a co-dragged overlapping frame cannot nest there', () => {
    const { store, tool } = setup(), a = makeNode('frame', 50, 0), b = makeNode('frame', 100, 0), shape = { ...makeNode('rect', 10, 10), parent: b.id };
    store.init([a, b, shape]); tool.original.set(a.id, a); tool.original.set(shape.id, shape);
    tool.moved = true; tool.start = { x: 120, y: 40 };
    tool.onPointerUp({ x: 125, y: 50 });
    expect(store.doc.get(a.id)?.parent).toBe(null);
    expect(store.doc.get(shape.id)?.parent).toBe(b.id);
});
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

it.each([90, 30])('resizes a group inside a %s degree frame along its displayed axes', rotation => {
    const { store, tool } = setup(), frame = { ...makeNode('frame', 0, 0), w: 600, h: 600, rotation }, g = { ...makeNode('group', 100, 100), w: 200, h: 100, parent: frame.id }, nested = { ...makeNode('group', 0, 0), w: 80, h: 100, parent: g.id }, a = { ...makeNode('rect', 0, 0), w: 80, h: 100, parent: nested.id }, b = { ...makeNode('rect', 120, 0), w: 80, h: 100, parent: g.id };
    store.init([frame, g, nested, a, b]); store.selection.add(g.id);
    const hs = tool.selectionHandles(), matrix = worldMatrix(store.doc, g), end = transform(matrix, { x: 300, y: 50 }), event = { timeStamp: 1000 } as PointerEvent;
    tool.onPointerDown(hs[3], event); expect(tool.original.size).toBe(4);
    tool.onPointerMove(transform(matrix, { x: 250, y: 50 }), event); tool.onPointerMove(end, event); tool.onPointerUp(end);
    const result = store.doc.get(g.id)!;
    expect(result.w).toBeCloseTo(300); expect(result.h).toBeCloseTo(100);
    expect(store.doc.get(a.id)?.w).toBeCloseTo(120); expect(store.doc.get(a.id)?.x).toBeCloseTo(0); expect(store.doc.get(b.id)?.x).toBeCloseTo(180);
    expect(tool.selectionHandles()[7].x).toBeCloseTo(hs[7].x); expect(tool.selectionHandles()[7].y).toBeCloseTo(hs[7].y);
    expect(tool.selectionHandles()[3].x).toBeCloseTo(end.x); expect(tool.selectionHandles()[3].y).toBeCloseTo(end.y);
    expect(store.undoStack).toHaveLength(1); store.history(); expect(store.doc.get(g.id)?.w).toBe(200); store.history(true); expect(store.doc.get(g.id)?.w).toBeCloseTo(300);
});
