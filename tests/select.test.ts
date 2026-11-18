import { it, expect } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { world } from '../src/shared/geometry';
import { Store } from '../src/client/store';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';
import { duplicateNodes } from '../src/client/tools/duplicate';
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
const pointer = (altKey = false, buttons = 1) => ({ altKey, buttons, ctrlKey: true, timeStamp: 1000 } as PointerEvent);
it('deep duplicates a hierarchy just above its original with independent nested data', () => {
    const a = makeNode('frame', 0, 0), child = { ...makeNode('path', 10, 20), parent: a.id }, next = { ...makeNode('rect', 200, 0), index: 'z' };
    const doc = new Map([a, child, next].map(n => [n.id, n]));
    const copies = duplicateNodes(doc, [a, child]);
    expect(copies.size).toBe(2); expect(copies.get(child.id)?.parent).toBe(copies.get(a.id)?.id);
    expect(copies.get(a.id)!.index > a.index).toBe(true); expect(copies.get(a.id)!.index < next.index).toBe(true);
    expect(copies.get(child.id)?.points).not.toBe(child.points);
    expect(duplicateNodes(doc, []) .size).toBe(0);
});
it('alt-drags copies through normal ops with one undo and redo, leaving originals unmoved', () => {
    const { store, tool } = setup(), a = makeNode('rect', 20, 30); store.init([a]); store.selection.add(a.id);
    const sent: unknown[] = []; store.send = ops => sent.push(...ops);
    tool.onPointerDown({ x: 50, y: 60 }, pointer(true));
    tool.onPointerMove({ x: 90, y: 110 }, pointer(true)); tool.onPointerUp({ x: 90, y: 110 });
    const copy = store.doc.get([...store.selection][0])!;
    expect(copy.x).toBe(60); expect(copy.y).toBe(80); expect(store.doc.get(a.id)?.x).toBe(20);
    expect(sent).toContainEqual({ t: 'create', node: expect.objectContaining({ id: copy.id }) });
    expect(store.undoStack).toHaveLength(1); store.history(); expect(store.doc.size).toBe(1);
    store.history(true); expect(store.doc.get(copy.id)?.x).toBe(60);
});
it('toggles copies mid-drag, ignores stray moves, and undoes the final original move', () => {
    const { store, tool } = setup(), a = makeNode('rect', 20, 30); store.init([a]); store.selection.add(a.id);
    tool.onPointerDown({ x: 50, y: 60 }, pointer());
    tool.onPointerMove({ x: 90, y: 110 }, pointer());
    tool.modifier(true); expect(store.doc.size).toBe(2); expect(store.doc.get(a.id)?.x).toBe(20);
    tool.onPointerMove({ x: 500, y: 500 }, pointer(true, 0));
    expect(store.doc.get([...store.selection][0])?.x).toBe(60);
    tool.modifier(false); expect(store.doc.size).toBe(1); expect([...store.selection]).toEqual([a.id]);
    tool.onPointerUp({ x: 90, y: 110 }); expect(store.doc.get(a.id)?.x).toBe(60);
    store.history(); expect(store.doc.get(a.id)?.x).toBe(20);
});
it('does not duplicate alt-clicks, subthreshold moves, empty canvas or locked nodes', () => {
    for (const locked of [false, true]) {
        const { store, tool } = setup(), a = { ...makeNode('rect', 20, 30), locked }; store.init([a]);
        tool.onPointerDown({ x: 50, y: 60 }, pointer(true));
        tool.onPointerMove({ x: 51, y: 60 }, pointer(true)); tool.onPointerUp({ x: 51, y: 60 });
        expect(store.doc.size).toBe(1); expect(store.undoStack).toHaveLength(0);
        tool.onPointerDown({ x: 400, y: 400 }, pointer(true)); tool.onPointerMove({ x: 500, y: 500 }, pointer(true)); tool.onPointerUp({ x: 500, y: 500 });
        expect(store.doc.size).toBe(1);
    }
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

it('duplicates a sibling whose index ties with the next one', () => {
        const doc = new Map() as any;
        const base = { type: 'rect', x: 0, y: 0, w: 10, h: 10, parent: null, index: 'a' };
        doc.set('a', { ...base, id: 'a', name: 'a' });
        doc.set('b', { ...base, id: 'b', name: 'b' });
        const copies = duplicateNodes(doc, [doc.get('a')]);
        expect([...copies.values()][0].index > 'a').toBe(true);
});
