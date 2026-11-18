import { expect, it, vi } from 'vitest';
import { center, matrixAngle, transform, worldCorners } from '../src/shared/geometry';
import { Select } from '../src/client/tools/select';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import { children, makeNode } from '../src/shared/doc';
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
it('inserts keyboard duplicates immediately after the original auto-layout child', () => {
    const store = new Store(), frame = { ...makeNode('frame', 0, 0), layout: 'horizontal' as const, w: 400 };
    const nodes = ['a', 'b', 'c'].map((id, index) => ({ ...makeNode('rect', 0, 0), id, parent: frame.id, index: String(index), w: 20 }));
    store.init([frame, ...nodes]); store.selection.add('a');
    const select = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} });
    select.onKey({ key: 'd', ctrlKey: true, preventDefault() {} } as KeyboardEvent);
    const copy = [...store.selection][0];
    expect(children(store.doc, frame.id).map(n => n.id)).toEqual(['a', copy, 'b', 'c']);
    store.history(); expect(children(store.doc, frame.id).map(n => n.id)).toEqual(['a', 'b', 'c']);
    store.history(true); expect(children(store.doc, frame.id).map(n => n.id)).toEqual(['a', copy, 'b', 'c']);
});
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
import { aabb, worldMatrix } from '../src/client/geometry';
import { duplicateNodes } from '../src/client/tools/duplicate';
import * as autolayout from '../src/client/autolayout';
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
    const { store, tool } = setupCanvas(), a = makeNode('rect', 20, 30); store.init([a]); store.selection.add(a.id);
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
    const { store, tool } = setupCanvas(), a = makeNode('rect', 20, 30); store.init([a]); store.selection.add(a.id);
    tool.onPointerDown({ x: 50, y: 60 }, pointer());
    tool.onPointerMove({ x: 90, y: 110 }, pointer());
    tool.modifier(true); expect(store.doc.size).toBe(2); expect(store.doc.get(a.id)?.x).toBe(20);
    tool.onPointerMove({ x: 500, y: 500 }, pointer(true, 0));
    expect(store.doc.get([...store.selection][0])?.x).toBe(60);
    tool.modifier(false); expect(store.doc.size).toBe(1); expect([...store.selection]).toEqual([a.id]);
    tool.onPointerUp({ x: 90, y: 110 }); expect(store.doc.get(a.id)?.x).toBe(60);
    store.history(); expect(store.doc.get(a.id)?.x).toBe(20);
});
it('drops an auto-layout duplicate in the last slot and removes it in one undo step', () => {
    const { store, tool } = setupCanvas();
    const frame = { ...makeNode('frame', 0, 0), layout: 'horizontal' as const, w: 500, h: 100, gap: 10 };
    const nodes = ['A', 'B', 'C'].map(index => ({ ...makeNode('rect', 0, 0, index), parent: frame.id, w: 80, h: 80 }));
    store.init([frame, ...nodes]); store.selection.add(nodes[0].id);
    const peer = new Store(); peer.init([...store.doc.values()].map(n => structuredClone(n)));
    store.send = ops => peer.remote(ops);
    tool.onPointerDown({ x: 40, y: 40 }, pointer(true));
    tool.onPointerMove({ x: 490, y: 40 }, pointer(true));
    tool.onPointerUp({ x: 490, y: 40 });
    const copy = [...store.selection][0];
    const order = [...nodes.map(n => n.id), copy];
    expect(children(store.doc, frame.id).map(n => n.id)).toEqual(order);
    expect(children(peer.doc, frame.id).map(n => n.id)).toEqual(order);
    expect(store.doc.get(nodes[0].id)?.x).toBe(0);
    expect(store.undoStack).toHaveLength(1);
    store.history();
    expect(children(store.doc, frame.id).map(n => n.id)).toEqual(nodes.map(n => n.id));
    expect(store.doc.has(copy)).toBe(false); expect(peer.doc.has(copy)).toBe(false);
    store.history(true);
    expect(children(store.doc, frame.id).map(n => n.id)).toEqual(order);
    expect(children(peer.doc, frame.id).map(n => n.id)).toEqual(order);
});
it('does not duplicate alt-clicks, subthreshold moves, empty canvas or locked nodes', () => {
    for (const locked of [false, true]) {
        const { store, tool } = setupCanvas(), a = { ...makeNode('rect', 20, 30), locked }; store.init([a]);
        tool.onPointerDown({ x: 50, y: 60 }, pointer(true));
        tool.onPointerMove({ x: 51, y: 60 }, pointer(true)); tool.onPointerUp({ x: 51, y: 60 });
        expect(store.doc.size).toBe(1); expect(store.undoStack).toHaveLength(0);
        tool.onPointerDown({ x: 400, y: 400 }, pointer(true)); tool.onPointerMove({ x: 500, y: 500 }, pointer(true)); tool.onPointerUp({ x: 500, y: 500 });
        expect(store.doc.size).toBe(1);
    }
});
it.each([false, true])('closes a tied-index drop transaction (duplicate: %s)', duplicate => {
    const { store, tool } = setupCanvas();
    const frame = { ...makeNode('frame', 0, 0), layout: 'horizontal' as const, w: 500, h: 100, gap: 10 };
    const nodes = ['A', 'A', 'C'].map((index, i) => ({ ...makeNode('rect', 0, 0, index), id: String(i), parent: frame.id, w: 80, h: 80 }));
    store.init([frame, ...nodes]); store.selection.add(nodes[2].id);
    tool.onPointerDown({ x: 220, y: 40 }, pointer(duplicate));
    tool.onPointerMove({ x: 100, y: 40 }, pointer(duplicate));
    expect(() => tool.onPointerUp({ x: 100, y: 40 })).not.toThrow();
    expect(store.group).toBeNull(); expect(tool.start).toBeUndefined();
    const moving = [...store.selection][0];
    expect(children(store.doc, frame.id).map(n => n.id)).toEqual(duplicate ? ['0', '1', moving, '2'] : ['0', '1', '2']);
    expect(store.undoStack).toHaveLength(1); store.history();
    expect(children(store.doc, frame.id).map(n => n.id)).toEqual(['0', '1', '2']);
});
it('finalizes copies and closes the transaction even if drop processing throws', () => {
    const { store, tool } = setupCanvas(), a = makeNode('rect', 20, 30); store.init([a]); store.selection.add(a.id);
    tool.onPointerDown({ x: 50, y: 60 }, pointer(true)); tool.onPointerMove({ x: 90, y: 110 }, pointer(true));
    const mock = vi.spyOn(autolayout, 'dragInsertion').mockImplementation(() => { throw new Error('drop failed'); });
    try { expect(() => tool.onPointerUp({ x: 90, y: 110 })).toThrow('drop failed'); }
    finally { mock.mockRestore(); }
    expect(store.group).toBeNull(); expect(tool.start).toBeUndefined(); expect(tool.copies).toBeUndefined();
    expect(store.undoStack).toHaveLength(1); store.history(); expect([...store.doc.keys()]).toEqual([a.id]);
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

it('resizes grouped auto-width text around its measured center without a persistent jump', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText: (line: string) => ({ width: line.length * 10 }) }) }) });
    try {
        const { store, tool } = setupCanvas(), g = { ...makeNode('group', 100, 100), w: 200, h: 100 }, rect = { ...makeNode('rect', 0, 0), w: 200, h: 100, parent: g.id }, text = { ...makeNode('text', 20, 20), parent: g.id };
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
    const { store, tool } = setupCanvas(), frame = { ...makeNode('frame', 0, 0), w: 600, h: 600, rotation }, g = { ...makeNode('group', 100, 100), w: 200, h: 100, parent: frame.id }, nested = { ...makeNode('group', 0, 0), w: 80, h: 100, parent: g.id }, a = { ...makeNode('rect', 0, 0), w: 80, h: 100, parent: nested.id }, b = { ...makeNode('rect', 120, 0), w: 80, h: 100, parent: g.id };
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

it('duplicates a sibling whose index ties with the next one', () => {
        const doc = new Map() as any;
        const base = { type: 'rect', x: 0, y: 0, w: 10, h: 10, parent: null, index: 'a' };
        doc.set('a', { ...base, id: 'a', name: 'a' });
        doc.set('b', { ...base, id: 'b', name: 'b' });
        const copies = duplicateNodes(doc, [doc.get('a')]);
        expect([...copies.values()][0].index > 'a').toBe(true);
});

it('alt-drags a group in a rotated frame by the world delta and preserves its descendants', () => {
    const { store, tool } = setupCanvas(), parent = { ...makeNode('frame', 0, 0), w: 600, h: 600, rotation: 30 }, group = { ...makeNode('group', 100, 100), parent: parent.id }, child = { ...makeNode('rect', 0, 0), parent: group.id };
    store.init([parent, group, child]); store.selection.add(group.id);
    const before = worldCorners(store.doc, child), start = center(store.doc, group), end = { x: start.x + 20, y: start.y + 40 };
    tool.onPointerMove(start, pointer(true)); expect(tool.cursor).toBe('copy');
    tool.onPointerDown(start, pointer(true)); tool.onPointerMove(end, pointer(true)); tool.onPointerUp(end);
    const copy = store.doc.get([...store.selection][0])!, nested = children(store.doc, copy.id)[0];
    expect(copy.id).not.toBe(group.id); expect(nested.id).not.toBe(child.id); expect(matrixAngle(worldMatrix(store.doc, nested))).toBeCloseTo(30);
    for (const [i, point] of worldCorners(store.doc, nested).entries()) { expect(point.x).toBeCloseTo(before[i].x + 20); expect(point.y).toBeCloseTo(before[i].y + 40); }
    expect(worldCorners(store.doc, child)).toEqual(before); expect(store.undoStack).toHaveLength(1);
    store.history(); expect(store.doc.size).toBe(3); store.history(true); expect(store.doc.has(nested.id)).toBe(true);
});

it('keeps the rotate affordance and rotation drag when Alt is held instead of duplicating', () => {
    const { store, tool } = setupCanvas(), node = makeNode('rect', 0, 0), start = { x: -8, y: -8 }, end = { x: 108, y: -8 };
    store.init([node]); store.selection.add(node.id);
    tool.onPointerMove(start, pointer(true)); expect(tool.cursor).toBe(tool.rotateCursor);
    tool.onPointerDown(start, pointer(true)); tool.onPointerMove(end, pointer(true)); tool.onPointerUp(end);
    expect(store.doc.size).toBe(1); expect(store.doc.get(node.id)?.rotation).toBeCloseTo(90); expect(store.undoStack).toHaveLength(1);
    store.history(); expect(store.doc.get(node.id)?.rotation).toBe(0);
});
it('rotates instances through root overrides without rotating the main', () => {
    const { store, select, instance, main } = setup(), start = { x: 192, y: -8 }, end = { x: 308, y: -8 }, event = { buttons: 1 } as PointerEvent;
    store.selection.add(instance.id);
    select.onPointerDown(start, event); select.onPointerMove(end, event); select.onPointerUp(end);
    expect(expand(store.doc).get(instance.id)?.rotation).toBeCloseTo(90);
    expect(store.doc.get(main.id)?.rotation).toBe(0);
    store.history(); expect(expand(store.doc).get(instance.id)?.rotation).toBe(0);
    store.history(true); expect(expand(store.doc).get(instance.id)?.rotation).toBeCloseTo(90);
});
