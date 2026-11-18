import { expect, it } from 'vitest';
import { Select } from '../src/client/tools/select';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import { makeNode } from '../src/shared/doc';
import { expand, instanceNode } from '../src/shared/components';
import { Shape } from '../src/client/tools/shape';
import { world } from '../src/shared/geometry';
it('resizes inherited Hug instance bounds and changes only its sizing to Fixed', () => {
    const store = new Store(), main = { ...makeNode('frame', 0, 0), component: true, layout: 'horizontal' as const, sizeW: 'hug' as const, sizeH: 'hug' as const };
    const child = { ...makeNode('rect', 0, 0), parent: main.id, w: 80, h: 30 }, instance = instanceNode(main, 200, 0);
    store.init([main, child, instance]); store.selection.add(instance.id);
    const select = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} });
    select.onPointerDown({ x: 280, y: 30 }, { buttons: 1 } as PointerEvent);
    expect(select.handle).toBe(4);
    select.onPointerMove({ x: 320, y: 50 }, { buttons: 1 } as PointerEvent);
    select.onPointerUp({ x: 320, y: 50 });
    expect(expand(store.doc).get(instance.id)).toMatchObject({ w: 120, h: 50, sizeW: 'fixed', sizeH: 'fixed' });
    expect(store.doc.get(instance.id)?.overrides?.['']).toMatchObject({ sizeW: 'fixed', sizeH: 'fixed' });
    expect(store.doc.get(main.id)).toMatchObject({ w: 80, h: 30, sizeW: 'hug', sizeH: 'hug' });
    store.history(); expect(expand(store.doc).get(instance.id)).toMatchObject({ w: 80, h: 30, sizeW: 'hug', sizeH: 'hug' });
    store.history(true); expect(expand(store.doc).get(instance.id)).toMatchObject({ w: 120, h: 50 });
});
function setup() {
    const store = new Store(), main = { ...makeNode('frame', 0, 0), component: true }, child = { ...makeNode('rect', 10, 10), w: 30, h: 30, parent: main.id }, instance = instanceNode(main, 200, 0);
    store.init([main, child, instance]);
    const select = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} });
    const key = (key: string, ctrlKey = false) => select.onKey({ key, ctrlKey, preventDefault() {} } as KeyboardEvent);
    return { store, main, child, instance, select, key };
}
it('selects instances as leaves or deep-selects virtual children without changing them', () => {
    const { select, instance, child, store, key } = setup(), p = { x: 220, y: 20 };
    expect(select.pick(p)?.id).toBe(instance.id);
    expect(select.pick(p, true)?.id).toBe(instance.id + '/' + child.id);
    select.deepSelect(p); key('ArrowRight'); key('Delete'); key('d', true);
    expect(store.doc.size).toBe(3); expect(store.doc.get(child.id)?.x).toBe(10);
    expect(select.pick({ x: -100, y: -100 })).toBeUndefined();
});
it('duplicates a main as an instance and duplicates an instance with its overrides', () => {
    const { store, main, key } = setup(); store.selection.add(main.id); key('d', true);
    const id = [...store.selection][0], n = store.doc.get(id)!;
    expect(n.instanceOf).toBe(main.id); expect(n.x).toBe(20); expect(store.doc.size).toBe(4);
    store.commit([{ t: 'override', id, target: '', key: 'fill', value: '#112233' }]); key('d', true);
    expect(store.doc.get([...store.selection][0])?.overrides).toEqual({ '': { fill: '#112233' } });
});
it('detaches surviving instances when deleting a main in one undoable transaction', () => {
    const { store, main, instance, key } = setup(); store.selection.add(main.id); key('Delete');
    expect(store.doc.has(main.id)).toBe(false); expect(store.doc.get(instance.id)?.instanceOf).toBeUndefined();
    expect([...store.doc.values()].some(n => n.parent === instance.id)).toBe(true);
    store.history(); expect(store.doc.get(instance.id)?.instanceOf).toBe(main.id); expect(store.doc.has(main.id)).toBe(true);
});
it('does not reparent on a deep-selection pointerup or drop shapes into instances', () => {
    const { store, select, instance } = setup();
    select.original.set(instance.id, instance); select.moved = true;
    select.onPointerDown({ x: 220, y: 20 }, { ctrlKey: true } as PointerEvent);
    select.onPointerUp({ x: 10, y: 10 });
    expect(store.doc.get(instance.id)?.parent).toBeNull();
    const shape = new Shape(select.ctx, 'rect', () => {});
    shape.onPointerDown({ x: 220, y: 20 }); shape.onPointerUp();
    expect(store.doc.get([...store.selection][0])?.parent).toBeNull();
});
it.each(['ctrlKey', 'metaKey'])('does not replay a completed drag after %s deep selection', modifier => {
    const { store, select, main, child } = setup(), frame = { ...makeNode('frame', 400, 0), w: 300, h: 300 };
    const nested = instanceNode(main, 20, 20, frame.id), moving = makeNode('rect', 700, 400);
    store.commit([{ t: 'create', node: frame }, { t: 'create', node: nested }, { t: 'create', node: moving }]);
    store.selection.add(moving.id);
    select.onPointerDown({ x: 750, y: 450 }, { buttons: 1 } as PointerEvent);
    select.onPointerMove({ x: 800, y: 450 }, { buttons: 1 } as PointerEvent);
    select.onPointerUp({ x: 800, y: 450 });
    const before = store.doc.get(moving.id), count = store.undoStack.length;
    select.onPointerDown({ x: 440, y: 40 }, { [modifier]: true } as unknown as PointerEvent);
    select.onPointerUp({ x: 440, y: 40 });
    expect([...store.selection]).toEqual([nested.id + '/' + child.id]);
    expect(store.doc.get(moving.id)).toBe(before); expect(store.doc.get(moving.id)?.parent).toBeNull();
    expect(store.undoStack).toHaveLength(count); expect(select.original.size).toBe(0); expect(select.moved).toBe(false);
});

const layerKey = (tool: Select, key: string, extra = {}) => tool.onKey({ key, preventDefault() {}, ...extra } as KeyboardEvent);
const setupLayers = () => { const store = new Store(), tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }); return { store, tool }; };
const key = (tool: Select, key: string, extra = {}) => tool.onKey({ key, preventDefault() {}, ...extra } as KeyboardEvent);
const setupCanvas = () => { const store = new Store(), tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }); return { store, tool }; };
it('selects selectable top-level objects with Ctrl/Cmd+A, including an empty canvas', () => {
    const { store, tool } = setupCanvas(); key(tool, 'a', { ctrlKey: true }); expect(store.selection.size).toBe(0);
    const frame = makeNode('frame', 0, 0), child = { ...makeNode('rect', 0, 0), parent: frame.id }, hidden = { ...makeNode('rect', 0, 0), hidden: true };
    store.init([frame, child, hidden]); let prevented = false;
    key(tool, 'A', { metaKey: true, preventDefault() { prevented = true; } });
    expect(prevented).toBe(true); expect([...store.selection]).toEqual([frame.id]);
});
it('keeps overlapping sibling frames as siblings but allows fully contained drops', () => {
    const { store, tool } = setupCanvas(), a = makeNode('frame', 50, 0), b = makeNode('frame', 100, 0);
    store.init([a, b]); tool.original.set(a.id, a); tool.moved = true; tool.start = { x: 125, y: 50 };
    tool.onPointerUp({ x: 125, y: 50 }); expect(store.doc.get(a.id)?.parent).toBe(null);
    store.set(b.id, { x: 0, w: 300, h: 300 }); tool.start = { x: 125, y: 50 }; tool.original.set(a.id, store.doc.get(a.id)!); tool.moved = true; tool.onPointerUp({ x: 125, y: 50 });
    expect(store.doc.get(a.id)?.parent).toBe(b.id);
});
it('never reparents into another dragged frame or its descendants', () => {
    const { store, tool } = setupCanvas(), a = makeNode('frame', 50, 0), b = { ...makeNode('frame', 0, 0), w: 300, h: 300 }, child = { ...makeNode('frame', 0, 0), parent: b.id, w: 250, h: 250 };
    store.init([a, b, child]); tool.original.set(a.id, a); tool.original.set(b.id, b); tool.moved = true; tool.start = { x: 125, y: 50 };
    tool.onPointerUp({ x: 125, y: 50 });
    expect(store.doc.get(a.id)?.parent).toBe(null); expect(store.doc.get(b.id)?.parent).toBe(null);
    expect(store.doc.get(child.id)?.parent).toBe(b.id);
});
it('keeps a shape in its current parent when a co-dragged overlapping frame cannot nest there', () => {
    const { store, tool } = setupCanvas(), a = makeNode('frame', 50, 0), b = makeNode('frame', 100, 0), shape = { ...makeNode('rect', 10, 10), parent: b.id };
    store.init([a, b, shape]); tool.original.set(a.id, a); tool.original.set(shape.id, shape);
    tool.moved = true; tool.start = { x: 120, y: 40 };
    tool.onPointerUp({ x: 125, y: 50 });
    expect(store.doc.get(a.id)?.parent).toBe(null);
    expect(store.doc.get(shape.id)?.parent).toBe(b.id);
});
it('groups, nudges an inner node with normalized bounds and ungroups in single undo steps', () => {
    const { store, tool } = setupLayers(), a = makeNode('rect', 20, 30), b = { ...makeNode('ellipse', 200, 50), index: 'z' }; store.init([a, b]); store.selection.add(a.id); store.selection.add(b.id);
    layerKey(tool, 'g', { ctrlKey: true }); const g = store.doc.get([...store.selection][0])!; expect(g.type).toBe('group'); expect(store.undoStack).toHaveLength(1);
    store.selection.clear(); store.selection.add(a.id); layerKey(tool, 'ArrowLeft'); expect(world(store.doc, store.doc.get(a.id)!).x).toBe(19); expect(store.doc.get(g.id)?.x).toBe(19); expect(world(store.doc, store.doc.get(b.id)!).x).toBe(200);
    store.selection.clear(); store.selection.add(g.id); layerKey(tool, 'G', { ctrlKey: true, shiftKey: true }); expect(store.doc.has(g.id)).toBe(false); expect([...store.selection]).toEqual([a.id, b.id]); expect(store.undoStack).toHaveLength(3);
    store.history(); expect(store.doc.get(a.id)?.parent).toBe(g.id);
});
it('does not nudge or delete a locked node selected from layers, including locked ancestry', () => {
    const { store, tool } = setupLayers(), g = { ...makeNode('group', 0, 0), locked: true }, a = { ...makeNode('rect', 10, 20), parent: g.id }; store.init([g, a]); store.selection.add(a.id);
    layerKey(tool, 'ArrowRight'); layerKey(tool, 'Delete'); expect(store.doc.get(a.id)?.x).toBe(10); expect(store.doc.has(a.id)).toBe(true);
});
it('handles empty grouping, ungrouping, nudge and delete selections', () => {
    const { store, tool } = setupLayers(); layerKey(tool, 'g', { ctrlKey: true }); layerKey(tool, 'G', { ctrlKey: true, shiftKey: true }); layerKey(tool, 'ArrowRight'); layerKey(tool, 'Delete'); expect(store.doc.size).toBe(0); expect(store.undoStack).toHaveLength(0);
});
