import { it, expect } from 'vitest';
import { applyOp, makeNode, type Doc } from '../src/shared/doc';
import { constrain, constraintOps } from '../src/shared/constraints';
import { Store } from '../src/client/store';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';
import { transform, worldMatrix } from '../src/shared/geometry';
import { expand, instanceNode } from '../src/shared/components';

const from = { w: 200, h: 100 }, to = { w: 300, h: 160 };
const box = { ...makeNode('rect', 20, 10), w: 40, h: 20 };
it.each([
    ['left', 80, 20], ['right', 30, 20], ['center', 55, 20], ['scale', 40, 10], ['both', 80, 1]
] as const)('resolves instance %s pins without changing the main', (constraintH, x, w) => {
    const main = { ...makeNode('frame', 0, 0), component: true };
    const child = { ...makeNode('rect', 80, 10), parent: main.id, w: 20, h: 20, constraintH, constraintV: 'bottom' as const };
    const instance = { ...instanceNode(main, 200, 0), w: 50, h: 150 };
    const doc: Doc = new Map([main, child, instance].map(n => [n.id, n]));
    expect(expand(doc).get(instance.id + '/' + child.id)).toMatchObject({ x, y: 60, w, h: 20 });
    expect(doc.get(child.id)).toMatchObject({ x: 80, y: 10, w: 20 });
    expect(expand(doc).get(child.id)).toEqual(child);
});
it('uses overridden pins through nested constrained frames and instances', () => {
    const main = { ...makeNode('frame', 0, 0), component: true };
    const frame = { ...makeNode('frame', 0, 0), parent: main.id, constraintH: 'both' as const };
    const child = { ...makeNode('rect', 80, 0), parent: frame.id, w: 20, constraintH: 'left' as const };
    const instance = { ...instanceNode(main, 200, 0), w: 50, overrides: { [child.id]: { constraintH: 'right' } } };
    const store = new Store(); store.init([main, frame, child, instance]);
    expect(expand(store.doc).get(instance.id + '/' + child.id)).toMatchObject({ x: 30 });
    store.set(main.id, { constraintH: 'right' });
    expect(expand(store.doc).get(instance.id)?.constraintH).toBe('right');
    store.set(instance.id, { constraintH: 'both' });
    store.set(instance.id + '/' + child.id, { constraintH: 'center' });
    expect(expand(store.doc).get(instance.id)?.constraintH).toBe('both');
    expect(expand(store.doc).get(instance.id + '/' + child.id)).toMatchObject({ constraintH: 'center', x: 55 });
    store.history(); store.history();
    expect(expand(store.doc).get(instance.id)?.constraintH).toBe('right');
    expect(expand(store.doc).get(instance.id + '/' + child.id)?.constraintH).toBe('right');
});
it('pins each axis per constraint', () => {
    expect(constrain(box, from, to)).toEqual({ x: 20, y: 10, w: 40, h: 20 });
    expect(constrain({ ...box, constraintH: 'right', constraintV: 'bottom' }, from, to)).toEqual({ x: 120, y: 70, w: 40, h: 20 });
    expect(constrain({ ...box, constraintH: 'both', constraintV: 'both' }, from, to)).toEqual({ x: 20, y: 10, w: 140, h: 80 });
    expect(constrain({ ...box, constraintH: 'center', constraintV: 'center' }, from, to)).toEqual({ x: 70, y: 40, w: 40, h: 20 });
    expect(constrain({ ...box, constraintH: 'scale', constraintV: 'scale' }, from, to)).toEqual({ x: 30, y: 16, w: 60, h: 32 });
    expect(constrain({ ...box, constraintH: 'both' }, from, { w: 10, h: 100 }).w).toBe(1);
});
it('keeps auto text size and recurses through nested frames and groups', () => {
    const doc: Doc = new Map(), f = { ...makeNode('frame', 0, 0), w: 200, h: 100 }, inner = { ...makeNode('frame', 0, 0), parent: f.id, w: 200, h: 50, constraintH: 'both' as const };
    const pin = { ...makeNode('rect', 180, 0), parent: inner.id, w: 20, h: 20, constraintH: 'right' as const }, text = { ...makeNode('text', 0, 60), parent: f.id, constraintH: 'scale' as const };
    const g = { ...makeNode('group', 100, 60), parent: f.id, w: 40, h: 40, constraintH: 'scale' as const }, gc = { ...makeNode('rect', 20, 0), parent: g.id, w: 20, h: 40 };
    for (const node of [f, inner, pin, text, g, gc]) applyOp(doc, { t: 'create', node });
    for (const op of constraintOps(doc, f.id, { w: 400, h: 100 })) applyOp(doc, op);
    expect(doc.get(inner.id)).toMatchObject({ w: 400 });
    expect(doc.get(pin.id)).toMatchObject({ x: 380, w: 20 });
    expect(doc.get(text.id)).toMatchObject({ x: 0, w: text.w });
    expect(doc.get(g.id)).toMatchObject({ x: 200, w: 80 });
    expect(doc.get(gc.id)).toMatchObject({ x: 40, w: 40 });
    expect(constraintOps(doc, f.id, { w: 200, h: 100 })).toEqual([]);
});
it('rejects unknown constraint values', () => {
    const doc: Doc = new Map(), n = makeNode('rect', 0, 0); applyOp(doc, { t: 'create', node: n });
    applyOp(doc, { t: 'set', id: n.id, key: 'constraintH', value: 'stretch' as never });
    applyOp(doc, { t: 'set', id: n.id, key: 'constraintV', value: 'bottom' });
    expect(doc.get(n.id)).toMatchObject({ constraintV: 'bottom' }); expect(doc.get(n.id)?.constraintH).toBeUndefined();
});
it('applies constraints while dragging a frame handle, in one undo step', () => {
    const store = new Store(), tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} });
    const f = { ...makeNode('frame', 0, 0), w: 200, h: 100 }, a = { ...makeNode('rect', 150, 10), parent: f.id, w: 40, h: 20, constraintH: 'right' as const, constraintV: 'center' as const };
    store.init([f, a]); store.selection.add(f.id);
    const ev = (x: number, y: number) => ({ timeStamp: 0, shiftKey: false, altKey: false, buttons: 1, clientX: x, clientY: y } as PointerEvent);
    tool.onPointerDown({ x: 200, y: 100 }, ev(200, 100)); tool.onPointerMove({ x: 300, y: 160 }, ev(300, 160)); tool.onPointerUp({ x: 300, y: 160 });
    expect(store.doc.get(f.id)).toMatchObject({ w: 300, h: 160 });
    expect(store.doc.get(a.id)).toMatchObject({ x: 250, y: 40, w: 40, h: 20 });
    store.history(); expect(store.doc.get(a.id)).toMatchObject({ x: 150, y: 10 });
});
it('restores children when a drag returns to the starting size, and leaves auto layout children to the layout engine', () => {
    const doc: Doc = new Map(), f = { ...makeNode('frame', 0, 0), w: 200, h: 100 }, a = { ...makeNode('rect', 150, 0), parent: f.id, w: 40, h: 20, constraintH: 'right' as const };
    for (const node of [f, a]) applyOp(doc, { t: 'create', node });
    const base = new Map(doc);
    for (const op of constraintOps(base, f.id, { w: 300, h: 100 })) applyOp(doc, op);
    expect(doc.get(a.id)?.x).toBe(250);
    for (const op of constraintOps(base, f.id, { w: 200, h: 100 }, undefined, doc)) applyOp(doc, op);
    expect(doc.get(a.id)?.x).toBe(150);
    applyOp(doc, { t: 'set', id: f.id, key: 'layout', value: 'horizontal' });
    expect(constraintOps(doc, f.id, { w: 400, h: 100 })).toEqual([]);
    const inner = { ...makeNode('frame', 0, 0), parent: f.id, w: 200, h: 100, sizeW: 'fill' as const }, pin = { ...makeNode('rect', 150, 0), parent: inner.id, w: 40, h: 20, constraintH: 'right' as const };
    for (const node of [inner, pin]) applyOp(doc, { t: 'create', node });
    expect(constraintOps(new Map(doc), f.id, { w: 400, h: 100 })).toContainEqual({ t: 'set', id: pin.id, key: 'x', value: 310 });
    const label = { ...makeNode('text', 0, 0), parent: f.id, text: 'Hi', w: 30, h: 20, textWidth: 'auto' as const, sizeW: 'fill' as const };
    applyOp(doc, { t: 'create', node: label });
    expect(constraintOps(new Map(doc), f.id, { w: 400, h: 100 })).toContainEqual({ t: 'set', id: pin.id, key: 'x', value: 280 });
    const moved = new Map(doc);
    for (const op of constraintOps(doc, f.id, { w: 400, h: 100 })) applyOp(moved, op);
    expect(constraintOps(doc, f.id, { w: 200, h: 100 }, undefined, moved)).toContainEqual({ t: 'set', id: pin.id, key: 'x', value: 80 });
});

it.each([90, 30])('constrains children while resizing a %s degree frame inside a rotated parent', rotation => {
    const store = new Store(), tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }), parent = { ...makeNode('frame', 0, 0), w: 600, h: 600, rotation: 20 }, f = { ...makeNode('frame', 100, 100), parent: parent.id, w: 200, h: 100, rotation }, a = { ...makeNode('rect', 150, 10), parent: f.id, w: 40, h: 20, rotation: 45, constraintH: 'right' as const, constraintV: 'center' as const };
    store.init([parent, f, a]); store.selection.add(f.id);
    const matrix = worldMatrix(store.doc, f), start = tool.selectionHandles()[4], end = transform(matrix, { x: 300, y: 160 }), fixed = tool.selectionHandles()[0], event = { buttons: 1, altKey: false, timeStamp: 0 } as PointerEvent;
    const check = (x: number, y: number) => { const result = store.doc.get(a.id)!; expect(result.x).toBeCloseTo(x); expect(result.y).toBeCloseTo(y); expect(result).toMatchObject({ w: 40, h: 20, rotation: 45 }); };
    tool.onPointerDown(start, event); tool.onPointerMove(end, event); check(250, 40);
    tool.onPointerMove(start, event); check(150, 10);
    tool.onPointerMove(end, event); tool.onPointerUp(end);
    expect(store.doc.get(f.id)?.w).toBeCloseTo(300); expect(store.doc.get(f.id)?.h).toBeCloseTo(160);
    expect(tool.selectionHandles()[0].x).toBeCloseTo(fixed.x); expect(tool.selectionHandles()[0].y).toBeCloseTo(fixed.y);
    check(250, 40);
    expect(store.undoStack).toHaveLength(1); store.history(); check(150, 10);
});
