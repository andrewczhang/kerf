import { expect, it } from 'vitest';
import { addAutoLayout, dragInsertion, eligibleDropFrames, insertionSlot, isAutoLayout, layoutInsertions, reorderInAutoLayout, wrapInAutoLayout } from '../src/client/autolayout';
import { Store } from '../src/client/store';
import { children, makeNode, type Node } from '../src/shared/doc';
import { center, matrixAngle, transform, world, worldMatrix } from '../src/shared/geometry';
import { Select } from '../src/client/tools/select';
import type { Context } from '../src/client/tools/tool';

function setup(nodes: Node[]) { const store = new Store(); store.send = () => {}; store.init(nodes); return store; }

it.each([30, 90])('requires complete sibling-frame containment in a %s degree drop target', rotation => {
    const parent = { ...makeNode('frame', 100, 100), w: 300, h: 300, rotation }, child = { ...makeNode('frame', 200, 200), rotation }, s = setup([parent, child]), pointer = { x: 250, y: 250 };
    expect(eligibleDropFrames(s.doc, [child], pointer, pointer).map(n => n.id)).toEqual([parent.id]);
    s.set(child.id, { x: 50, y: 50, w: 400, h: 400 });
    expect(eligibleDropFrames(s.doc, [s.doc.get(child.id)!], pointer, pointer)).toEqual([]);
});
it('rejects overlapping sibling auto-layout targets and ignores ineligible manual targets', () => {
    const moving = makeNode('frame', 50, 0), overlap = { ...makeNode('frame', 100, 0), layout: 'horizontal' as const };
    const s = setup([moving, overlap]), pointer = { x: 125, y: 50 }, start = { x: 75, y: 50 };
    expect(dragInsertion(s.doc, [moving], pointer, start)).toBeUndefined();
    const target = { ...makeNode('frame', 0, 0), w: 400, h: 400, layout: 'horizontal' as const };
    const spacer = { ...makeNode('rect', 0, 0), parent: target.id };
    s.init([moving, { ...overlap, layout: 'none' }, target, spacer]);
    expect(dragInsertion(s.doc, [moving], pointer, start)?.parent).toBe(target.id);
});

it('restores exact root positions and parents after wrapping uneven rects and undoing', () => {
    const a = { ...makeNode('rect', 70, 485, 'A'), w: 55, h: 55 };
    const b = { ...makeNode('rect', 170, 500, 'B'), w: 70, h: 50 };
    const s = setup([a, b]), peer = setup([a, b].map(n => ({ ...n })));
    s.send = ops => peer.remote(ops);
    const snapshot = (store: Store) => [a, b].map(n => { const { x, y, w, h, parent } = store.doc.get(n.id)!; return { x, y, w, h, parent }; });
    const original = snapshot(s);
    const frame = wrapInAutoLayout(s, [a, b])!;
    const wrapped = snapshot(s);
    expect(wrapped[1].y).toBe(0);
    s.history();
    expect(s.doc.has(frame.id)).toBe(false); expect(snapshot(s)).toEqual(original); expect(snapshot(peer)).toEqual(original);
    s.history(true); expect(snapshot(s)).toEqual(wrapped); expect(snapshot(peer)).toEqual(wrapped); expect(s.doc.has(frame.id)).toBe(true);
});

it('restores a hug frame and cross-axis fill child after bottom-handle resize undo', () => {
    const p = { ...makeNode('frame', 100, 100), w: 400, h: 300, layout: 'horizontal' as const, padTop: 10, padBottom: 30 };
    const child = { ...makeNode('rect', 0, 0), parent: p.id, sizeH: 'fill' as const };
    const s = setup([p, child]);
    expect(s.doc.get(child.id)?.h).toBe(260);
    s.set(p.id, { sizeH: 'hug' }); expect(s.doc.get(p.id)?.h).toBe(300);
    s.selection.add(p.id);
    const peer = setup([...s.doc.values()].map(n => ({ ...n })));
    s.pending.clear(); s.send = ops => peer.remote(ops);
    const tool = new Select({ store: s, viewport: { zoom: 1 }, invalidate() {} } as Context), event = { shiftKey: false, altKey: false } as PointerEvent;
    tool.onPointerDown({ x: 300, y: 400 }, event);
    tool.onPointerMove({ x: 300, y: 430 }, event);
    tool.onPointerMove({ x: 300, y: 466.67 }, event);
    tool.onPointerUp({ x: 300, y: 466.67 });
    expect(s.doc.get(p.id)?.sizeH).toBe('fixed'); expect(s.doc.get(p.id)?.h).toBe(367);
    expect(s.doc.get(child.id)?.h).toBe(327);
    s.history();
    expect(s.doc.get(p.id)).toMatchObject({ sizeH: 'hug', h: 300 });
    expect(s.doc.get(child.id)?.h).toBe(260);
    expect(peer.doc.get(p.id)).toMatchObject({ sizeH: 'hug', h: 300 }); expect(peer.doc.get(child.id)?.h).toBe(260);
    s.history(true); expect(s.doc.get(p.id)).toMatchObject({ sizeH: 'fixed' }); expect(s.doc.get(p.id)?.h).toBe(367);
});

it('undoes and redoes all geometry derived by adding auto layout without sending derived ops', () => {
    const p = { ...makeNode('frame', 50, 60), w: 200.4, h: 100.4 };
    const items = [
        { ...makeNode('rect', 10.2, 15.2, 'Z'), parent: p.id, w: 30, h: 40 },
        { ...makeNode('rect', 70.2, 20.2, 'M'), parent: p.id, w: 30, h: 40 },
        { ...makeNode('rect', 141.2, 17.2, 'A'), parent: p.id, w: 30, h: 40 }
    ];
    const s = setup([p, ...items]);
    const geometry = () => [p, ...items].map(n => { const { x, y, w, h } = s.doc.get(n.id)!; return { x, y, w, h }; });
    const original = geometry();
    addAutoLayout(s, p);
    const laidOut = geometry();
    expect(laidOut).not.toEqual(original);
    expect(laidOut[0]).not.toEqual(original[0]);
    expect(laidOut[2]).not.toEqual(original[2]);
    expect([...s.pending.values()].flat().some(op => op.t === 'set' && ['x', 'y', 'w', 'h'].includes(op.key))).toBe(false);
    expect(s.undoStack).toHaveLength(1);
    s.history(); expect(geometry()).toEqual(original); expect(s.doc.get(p.id)?.layout).toBeUndefined();
    s.history(true); expect(geometry()).toEqual(laidOut); expect(s.doc.get(p.id)?.layout).toBe('horizontal');
});

it('guesses horizontal layout, average gap and edge padding, ordering by position', () => {
    const p = { ...makeNode('frame', 50, 60), w: 200, h: 100 };
    const a = { ...makeNode('rect', 10, 15, 'Z'), parent: p.id, w: 30, h: 40 };
    const b = { ...makeNode('rect', 70, 15, 'M'), parent: p.id, w: 30, h: 40 };
    const c = { ...makeNode('rect', 140, 15, 'A'), parent: p.id, w: 30, h: 40 };
    const s = setup([p, c, a, b]); addAutoLayout(s, p);
    expect(s.doc.get(p.id)).toMatchObject({ layout: 'horizontal', gap: 35, padLeft: 10, padRight: 30, padTop: 15, padBottom: 45, sizeW: 'hug', sizeH: 'hug' });
    expect(s.doc.get(a.id)!.index < s.doc.get(b.id)!.index && s.doc.get(b.id)!.index < s.doc.get(c.id)!.index).toBe(true);
    expect(s.undoStack).toHaveLength(1); s.history(); expect(s.doc.get(p.id)?.layout).toBeUndefined(); expect(s.doc.get(a.id)).toMatchObject({ x: 10, y: 15, index: 'Z' });
    s.history(true); expect(s.doc.get(p.id)?.layout).toBe('horizontal');
});

it('guesses vertical and rounds and clamps spacing and padding', () => {
    const p = makeNode('frame', 0, 0);
    const a = { ...makeNode('rect', -1, 10.4), w: 20, h: 30, parent: p.id };
    const b = { ...makeNode('rect', -1, 25), w: 20, h: 100, parent: p.id };
    const s = setup([p, b, a]); addAutoLayout(s, p);
    expect(s.doc.get(p.id)).toMatchObject({ layout: 'vertical', gap: 0, padLeft: 0, padTop: 10, padBottom: 0, padRight: 81 });
});

it('uses fixed empty defaults and ignores nonframes and already-auto frames', () => {
    const p = makeNode('frame', 0, 0), r = makeNode('rect', 0, 0); const s = setup([p, r]);
    addAutoLayout(s, r); expect(s.undoStack).toHaveLength(0);
    addAutoLayout(s, p); expect(s.doc.get(p.id)).toMatchObject({ layout: 'vertical', gap: 10, padLeft: 10, padTop: 10, padBottom: 10, padRight: 10, sizeW: 'fixed', sizeH: 'fixed', w: 100, h: 100 });
    addAutoLayout(s, s.doc.get(p.id)!); expect(s.undoStack).toHaveLength(1);
});

it('wraps siblings in their parent, preserving aligned world positions and undoing in one step', () => {
    const p = makeNode('frame', 100, 80);
    const a = { ...makeNode('rect', 10, 20, 'A'), parent: p.id, w: 20, h: 30 };
    const b = { ...makeNode('rect', 50, 20, 'B'), parent: p.id, w: 20, h: 30 };
    const s = setup([p, a, b]), before = [world(s.doc, a), world(s.doc, b)];
    const f = wrapInAutoLayout(s, [b, a])!;
    expect(f).toMatchObject({ parent: p.id, index: 'A', x: 10, y: 20, w: 60, h: 30, layout: 'horizontal', gap: 20 });
    expect([world(s.doc, s.doc.get(a.id)!), world(s.doc, s.doc.get(b.id)!)]).toEqual(before);
    expect([...s.selection]).toEqual([f.id]); expect(s.undoStack).toHaveLength(1);
    s.history(); expect(s.doc.has(f.id)).toBe(false); expect(s.doc.get(a.id)).toMatchObject({ parent: p.id, x: 10, y: 20 });
    s.history(true); expect(s.doc.get(a.id)?.parent).toBe(f.id);
});

it('handles empty input, ancestor selection, mixed parents and wrapping existing auto frames', () => {
    const p = { ...makeNode('frame', 100, 50), layout: 'vertical' as const };
    const a = { ...makeNode('rect', 0, 0), parent: p.id };
    const b = makeNode('rect', 250, 50); const s = setup([p, a, b]);
    expect(wrapInAutoLayout(s, [])).toBeUndefined(); expect(s.undoStack).toHaveLength(0);
    const f = wrapInAutoLayout(s, [p, a, b])!;
    expect(f.parent).toBeNull(); expect(s.doc.get(a.id)?.parent).toBe(p.id); expect(s.doc.get(p.id)?.parent).toBe(f.id);
});

function stack(direction: 'horizontal' | 'vertical' = 'horizontal') {
    const p = { ...makeNode('frame', 100, 100), w: 300, h: 300, layout: direction, gap: 10, padLeft: 20, padTop: 20, padRight: 20, padBottom: 20 };
    const items = ['A', 'B', 'C'].map(index => ({ ...makeNode('rect', 0, 0, index), parent: p.id, w: 50, h: 50 }));
    const s = setup([p, ...items]); return { s, p: s.doc.get(p.id)!, items: items.map(n => s.doc.get(n.id)!) };
}

it.each([30, 90])('computes insertion slots and lines in a %s degree frame', rotation => {
    const { s, p, items } = stack(); s.set(p.id, { rotation }); const frame = s.doc.get(p.id)!, m = worldMatrix(s.doc, frame);
    const pointer = transform(m, { x: 110, y: 40 }), insertion = insertionSlot(s.doc, frame, pointer, new Set([items[1].id]));
    expect(insertion.slot).toBe(1); expect(insertion.from).toEqual(transform(m, { x: 105, y: 20 })); expect(insertion.to).toEqual(transform(m, { x: 105, y: 280 }));
    expect(dragInsertion(s.doc, [items[1]], pointer, transform(m, { x: 105, y: 45 }))?.slot).toBe(1);
});

it('preserves accumulated angles when wrapping nodes from rotated parents', () => {
    const parent = { ...makeNode('frame', 100, 100), rotation: 45 }, a = { ...makeNode('rect', 10, 20), parent: parent.id, rotation: 20 }, b = { ...makeNode('rect', 400, 400), rotation: -30 }, s = setup([parent, a, b]);
    const frame = wrapInAutoLayout(s, [a, b])!;
    expect(frame.parent).toBeNull(); expect(matrixAngle(worldMatrix(s.doc, s.doc.get(a.id)!))).toBeCloseTo(65); expect(matrixAngle(worldMatrix(s.doc, s.doc.get(b.id)!))).toBeCloseTo(-30);
    s.history(); expect(s.doc.get(a.id)?.parent).toBe(parent.id); expect(s.doc.get(a.id)?.rotation).toBe(20);
});

it('drops a child out of a rotated auto-layout at the dragged world center', () => {
    const { s, p, items } = stack(); s.set(p.id, { rotation: 90 }); s.selection.add(items[0].id);
    const tool = new Select({ store: s, viewport: { zoom: 1 }, invalidate() {} } as Context), start = center(s.doc, s.doc.get(items[0].id)!), end = { x: 1000, y: 600 }, event = {} as PointerEvent;
    tool.onPointerDown(start, event); tool.onPointerMove(end, event); tool.onPointerUp(end);
    const result = s.doc.get(items[0].id)!; expect(result.parent).toBeNull(); expect(center(s.doc, result).x).toBeCloseTo(end.x); expect(center(s.doc, result).y).toBeCloseTo(end.y); expect(matrixAngle(worldMatrix(s.doc, result))).toBeCloseTo(90);
});

it.each(['horizontal', 'vertical'] as const)('computes %s slots in world space, excluding dragged items', direction => {
    const { s, p, items } = stack(direction), horizontal = direction === 'horizontal';
    const point = (v: number) => horizontal ? { x: v, y: 140 } : { x: 140, y: v };
    expect(insertionSlot(s.doc, p, point(0)).slot).toBe(0);
    expect(insertionSlot(s.doc, p, point(160)).slot).toBe(1);
    expect(insertionSlot(s.doc, p, point(1000)).slot).toBe(3);
    const insertion = insertionSlot(s.doc, p, point(210), new Set([items[1].id]));
    expect(insertion.slot).toBe(1);
    expect(insertion.from).toEqual(horizontal ? { x: 205, y: 120 } : { x: 120, y: 205 });
    const empty = insertionSlot(s.doc, p, point(200), new Set(items.map(n => n.id)));
    expect(empty.slot).toBe(0); expect(empty.from).toEqual({ x: 120, y: 120 });
});

it('reorders multiple children preserving their order, syncs indexes and undoes together', () => {
    const { s, p, items } = stack();
    const insertion = insertionSlot(s.doc, p, { x: 390, y: 130 }, new Set([items[0].id, items[1].id]));
    reorderInAutoLayout(s, [items[1], items[0]], insertion);
    expect(children(s.doc, p.id).map(n => n.id)).toEqual([items[2].id, items[0].id, items[1].id]);
    expect(s.undoStack).toHaveLength(1); expect([...s.pending.values()].flat().some(o => o.t === 'set' && o.key === 'index')).toBe(true);
    s.history(); expect(children(s.doc, p.id).map(n => n.id)).toEqual(items.map(n => n.id));
    s.history(true); expect(s.doc.get(items[0].id)?.x).toBe(80);
});

it('inserts free nodes, ignores invalid destinations, and does not allow cycles', () => {
    const { s, p, items } = stack(); const free = makeNode('rect', 500, 500); s.init([...s.doc.values(), free]);
    reorderInAutoLayout(s, [free], insertionSlot(s.doc, p, { x: 160, y: 140 }));
    expect(children(s.doc, p.id).map(n => n.id)).toEqual([items[0].id, free.id, items[1].id, items[2].id]);
    const before = JSON.stringify([...s.doc]);
    reorderInAutoLayout(s, [], insertionSlot(s.doc, p, { x: 0, y: 0 }));
    reorderInAutoLayout(s, [p], insertionSlot(s.doc, p, { x: 0, y: 0 }));
    reorderInAutoLayout(s, [free], { ...insertionSlot(s.doc, p, { x: 0, y: 0 }), parent: 'missing' });
    expect(JSON.stringify([...s.doc])).toBe(before);
});

it('keeps dragged children in flow until drop, shows local insertion, and leaves only fully outside', () => {
    const { s, p, items } = stack(); const first = items[0], start = { x: 140, y: 140 };
    expect(dragInsertion(s.doc, [first], { x: 95, y: 140 }, start)?.parent).toBe(p.id);
    expect(dragInsertion(s.doc, [first], { x: 0, y: 140 }, start)).toBeUndefined();
    s.selection.add(first.id);
    const tool = new Select({ store: s, viewport: { zoom: 1 }, invalidate() {} } as Context);
    const event = { shiftKey: false, altKey: false } as PointerEvent;
    tool.onPointerDown(start, event); tool.onPointerMove({ x: 350, y: 140 }, event);
    expect(s.doc.get(first.id)?.x).toBe(20); expect(layoutInsertions.has(s)).toBe(true);
    tool.onPointerUp({ x: 350, y: 140 });
    expect(children(s.doc, p.id).at(-1)?.id).toBe(first.id); expect(layoutInsertions.has(s)).toBe(false);
    const current = world(s.doc, s.doc.get(first.id)!); const nextStart = { x: current.x + 25, y: current.y + 25 };
    tool.onPointerDown(nextStart, event); tool.onPointerMove({ x: 600, y: 140 }, event); tool.onPointerUp({ x: 600, y: 140 });
    expect(s.doc.get(first.id)?.parent).toBeNull(); expect(world(s.doc, s.doc.get(first.id)!).x).toBe(575);
});

it('handle resizing switches only the resized axis from hug/fill to fixed in the drag group', () => {
    const p = { ...makeNode('frame', 100, 100), layout: 'horizontal' as const, sizeW: 'hug' as const, sizeH: 'hug' as const };
    const s = setup([p]); s.selection.add(p.id);
    const tool = new Select({ store: s, viewport: { zoom: 1 }, invalidate() {} } as Context), event = { shiftKey: false, altKey: false } as PointerEvent;
    tool.onPointerDown({ x: 200, y: 150 }, event); tool.onPointerMove({ x: 250, y: 150 }, event); tool.onPointerUp({ x: 250, y: 150 });
    expect(s.doc.get(p.id)).toMatchObject({ w: 150, h: 100, sizeW: 'fixed', sizeH: 'hug' });
    expect(s.undoStack).toHaveLength(1); s.history(); expect(s.doc.get(p.id)).toMatchObject({ w: 100, sizeW: 'hug' });
    expect(isAutoLayout(s.doc.get(p.id))).toBe(true);
});
