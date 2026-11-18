import { expect, it } from 'vitest';
import { applyOp, makeNode, normalizeNode, validNode, type Doc, type Node, type Op } from '../src/shared/doc';
import { aabb, center, hit, inverse, matrixAngle, nodeHandles, transform, world, worldCorners, worldMatrix } from '../src/shared/geometry';
import { groupOps, moveOps, normalizeGroups, rotateOps, ungroupOps } from '../src/shared/layers';
import { exportBounds, exportSVG } from '../src/client/export';
import { Store } from '../src/client/store';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';
import { Pen } from '../src/client/tools/pen';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
const apply = (doc: Doc, ops: Op[]) => ops.forEach(op => applyOp(doc, op));
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => { expect(a.x).toBeCloseTo(b.x, 7); expect(a.y).toBeCloseTo(b.y, 7); };
const event = (extra = {}) => ({ timeStamp: 1000, shiftKey: false, altKey: false, ...extra } as PointerEvent);

it('normalizes legacy and finite angles, rejects invalid rotations and keeps groups at zero', () => {
    const n = makeNode('rect', 0, 0), legacy = { ...n }; delete legacy.rotation;
    expect(validNode(legacy)).toBe(true); expect(normalizeNode(legacy).rotation).toBe(0);
    const doc = docOf(n);
    for (const [value, expected] of [[180, -180], [540, -180], [-181, 179], [725, 5]]) { applyOp(doc, { t: 'set', id: n.id, key: 'rotation', value }); expect(doc.get(n.id)?.rotation).toBe(expected); }
    for (const value of [NaN, Infinity, -Infinity]) { expect(validNode({ ...n, rotation: value })).toBe(false); applyOp(doc, { t: 'set', id: n.id, key: 'rotation', value }); expect(doc.get(n.id)?.rotation).toBe(5); }
    const group = { ...makeNode('group', 0, 0), rotation: 20 }; applyOp(doc, { t: 'create', node: group }); expect(doc.get(group.id)?.rotation).toBe(0);
    applyOp(doc, { t: 'set', id: group.id, key: 'rotation', value: 90 }); expect(doc.get(group.id)?.rotation).toBe(0);
});

it('composes centered matrices, keeps world boxes unrotated, and hits rotated rectangles', () => {
    const f = { ...makeNode('frame', 100, 100), w: 200, h: 200, rotation: 90 }, n = { ...makeNode('rect', 20, 30), w: 100, h: 40, rotation: 30, parent: f.id }, doc = docOf(f, n);
    near(center(doc, n), { x: 250, y: 170 }); expect(matrixAngle(worldMatrix(doc, n))).toBeCloseTo(120);
    expect(world(doc, n)).toEqual({ x: 120, y: 130, w: 100, h: 40 });
    const p = transform(worldMatrix(doc, n), { x: 10, y: 10 }); expect(hit(doc, p)?.id).toBe(n.id);
    expect(hit(doc, { x: 125, y: 135 })?.id).not.toBe(n.id);
    near(transform(inverse(worldMatrix(doc, n)), p), { x: 10, y: 10 });
});

it('tests ellipses and cubic paths in their rotated local coordinates', () => {
    const n = { ...makeNode('ellipse', 100, 100), w: 120, h: 20, rotation: 90 }, doc = docOf(n);
    expect(hit(doc, { x: 160, y: 65 })?.id).toBe(n.id); expect(hit(doc, { x: 105, y: 110 })).toBeUndefined();
    const p = { ...makeNode('path', 300, 100), rotation: 90, points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 1, y: 0, ix: 1, iy: 0, ox: 1, oy: 0 }] }; doc.set(p.id, p);
    expect(hit(doc, transform(worldMatrix(doc, p), { x: 40, y: 0 }))?.id).toBe(p.id);
});

it('preserves corners through grouping, ungrouping and reparenting across rotated parents', () => {
    const f = { ...makeNode('frame', 200, 100), rotation: 35 }, f2 = { ...makeNode('frame', -100, 200), rotation: -50, index: 'z' };
    const a = { ...makeNode('rect', 15, 20), w: 70, h: 30, rotation: 25, parent: f.id }, b = { ...makeNode('ellipse', 20, 15), rotation: -15, parent: f2.id };
    const doc = docOf(f, f2, a, b), before = new Map([a, b].map(n => [n.id, worldCorners(doc, n)]));
    const unchanged = () => { for (const id of [a.id, b.id]) worldCorners(doc, doc.get(id)!).forEach((p, i) => near(p, before.get(id)![i])); };
    apply(doc, groupOps(doc, [a.id, b.id])); unchanged();
    const g = [...doc.values()].find(n => n.type === 'group')!; expect(g.rotation).toBe(0);
    apply(doc, moveOps(doc, g.id, f.id)); unchanged();
    apply(doc, ungroupOps(doc, g.id)); unchanged();
    apply(doc, moveOps(doc, a.id, null)); unchanged();
});

it('normalizes groups using rotated child AABBs without changing world corners', () => {
    const g = makeNode('group', 100, 100), a = { ...makeNode('rect', 0, 0), w: 100, h: 20, rotation: 90, parent: g.id }, doc = docOf(g, a), before = worldCorners(doc, a);
    apply(doc, normalizeGroups(doc)); const result = doc.get(g.id)!;
    expect(result.w).toBeCloseTo(20); expect(result.h).toBeCloseTo(100); worldCorners(doc, doc.get(a.id)!).forEach((p, i) => near(p, before[i]));
});

it('replays group rotation snapshots live without accumulating bounds offsets', () => {
    const g = makeNode('group', 100, 100), n = { ...makeNode('rect', 0, 0), w: 100, h: 20, parent: g.id }, initial = docOf(g, n); apply(initial, normalizeGroups(initial));
    const live = new Map(initial), pivot = center(initial, initial.get(g.id)!);
    for (const angle of [30, 90, 140, 0]) { apply(live, rotateOps(initial, [g.id], pivot, angle)); const expected = new Map(initial); apply(expected, rotateOps(initial, [g.id], pivot, angle)); worldCorners(live, live.get(n.id)!).forEach((p, i) => near(p, worldCorners(expected, expected.get(n.id)!)[i])); }
});

it('exports rotated bounds and SVG transforms, including selected children of rotated frames', () => {
    const f = { ...makeNode('frame', 0, 0), rotation: 90 }, a = { ...makeNode('rect', 20, 30), w: 60, h: 20, parent: f.id }, doc = docOf(f, a), r = aabb(doc, a);
    expect(r.w).toBeCloseTo(20); expect(r.h).toBeCloseTo(60); expect(exportBounds(doc, [a])).toEqual({ x: 50, y: 20, w: 20, h: 60 });
    expect(exportSVG(doc, [a.id])).toContain('transform="matrix('); expect(exportSVG(doc, [f.id])).toContain('<clipPath');
});

it('handles empty and invalid rotation operations without changes', () => {
    expect(rotateOps(new Map(), [], { x: 0, y: 0 }, 90)).toEqual([]);
    expect(rotateOps(new Map(), ['missing'], { x: 0, y: 0 }, NaN)).toEqual([]);
});

it('rotates a selection live, shift snaps to 15 degrees and undoes as one drag', () => {
    const store = new Store(), n = { ...makeNode('rect', 100, 100), w: 100, h: 60 }, sent: Op[][] = [];
    store.init([n]); store.selection.add(n.id); store.send = ops => sent.push(ops);
    const tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }), c = { x: 150, y: 130 }, start = { x: 207, y: 93 };
    tool.onPointerMove(start, event()); expect(tool.cursor).toContain('data:image/svg'); tool.onPointerDown(start, event()); expect(tool.rotating).toBe(true);
    const angle = 32 * Math.PI / 180, p = { x: c.x + (start.x - c.x) * Math.cos(angle) - (start.y - c.y) * Math.sin(angle), y: c.y + (start.x - c.x) * Math.sin(angle) + (start.y - c.y) * Math.cos(angle) };
    tool.onPointerMove(p, event({ shiftKey: true })); expect(store.doc.get(n.id)?.rotation).toBeCloseTo(30); expect(sent.length).toBeGreaterThan(0); near(center(store.doc, store.doc.get(n.id)!), c);
    tool.onPointerUp(p); expect(store.undoStack).toHaveLength(1); store.history(); expect(store.doc.get(n.id)?.rotation).toBe(0);
});

it('orbits multi-selection centers and compensates for rotated parents', () => {
    const f = { ...makeNode('frame', 100, 100), rotation: 45 }, a = { ...makeNode('rect', 20, 20), w: 20, h: 20, parent: f.id }, b = { ...makeNode('ellipse', 300, 200), w: 40, h: 40 }, doc = docOf(f, a, b), pivot = { x: 200, y: 200 }, before = center(doc, a);
    apply(doc, rotateOps(doc, [a.id, b.id], pivot, 90)); near(center(doc, doc.get(a.id)!), { x: 400 - before.y, y: before.x }); expect(doc.get(a.id)?.rotation).toBe(90); expect(doc.get(b.id)?.rotation).toBe(90);
});

it('undoes angles crossing the normalization boundary', () => {
    const store = new Store(), n = makeNode('rect', 0, 0); store.init([n]); store.set(n.id, { rotation: 450 }); expect(store.doc.get(n.id)?.rotation).toBe(90); store.history(); expect(store.doc.get(n.id)?.rotation).toBe(0); store.history(true); expect(store.doc.get(n.id)?.rotation).toBe(90);
});

it('uses measured auto-text centers for rotation and reparenting', () => {
    const n = { ...makeNode('text', 30, 40), rotation: 25 }, f = { ...makeNode('frame', 200, 200), rotation: 45 }, doc = docOf(n, f), sizeOf = (n: Node) => n.type === 'text' ? { w: 70, h: 29 } : n;
    const c = center(doc, n, sizeOf); apply(doc, rotateOps(doc, [n.id], c, 35, sizeOf)); near(center(doc, doc.get(n.id)!, sizeOf), c);
    const before = worldCorners(doc, doc.get(n.id)!, sizeOf); apply(doc, moveOps(doc, n.id, f.id, {}, sizeOf)); worldCorners(doc, doc.get(n.id)!, sizeOf).forEach((p, i) => near(p, before[i]));
});

it('keeps rotated world-space path anchors fixed when pen editing refits the box', () => {
    const store = new Store(), f = { ...makeNode('frame', 100, 100), rotation: 20 }, n = { ...makeNode('path', 20, 20), rotation: 30, parent: f.id, points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: 0, oy: 0 }, { x: 1, y: 1, ix: 1, iy: 1, ox: 1, oy: 1 }] };
    store.init([f, n]); store.selection.add(n.id); const pen = new Pen({ store, viewport: new Viewport(() => {}), invalidate() {} }, () => {}), abs = pen.abs(n);
    abs[1] = { ...abs[1], x: abs[1].x + 30, ix: abs[1].ix + 30, ox: abs[1].ox + 30 }; pen.write(n, abs);
    pen.abs(store.doc.get(n.id)!).forEach((p, i) => { expect(p.x).toBeCloseTo(abs[i].x, 5); expect(p.y).toBeCloseTo(abs[i].y, 5); }); expect(store.doc.get(n.id)?.rotation).toBe(30);
});

it('multi-resizes rotated selections without skewing or invalid dimensions', () => {
    const store = new Store(), a = { ...makeNode('rect', 100, 100), rotation: 30 }, b = { ...makeNode('rect', 300, 100), rotation: -20 }; store.init([a, b]); store.selection.add(a.id); store.selection.add(b.id);
    const tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }), hs = tool.selectionHandles(), p = { x: hs[4].x + 70, y: hs[4].y + 35 };
    tool.onPointerDown(hs[4], event()); tool.onPointerMove(p, event()); tool.onPointerUp(p);
    for (const n of [a, b]) { const result = store.doc.get(n.id)!; expect(result.rotation).toBe(n.rotation); expect(result.w).toBeGreaterThan(n.w); expect(result.h).toBeGreaterThan(n.h); expect(validNode(result)).toBe(true); }
});

it('resizes a rotated child along its local axes, keeping the opposite corner fixed', () => {
    const store = new Store(), f = { ...makeNode('frame', 0, 0), w: 400, h: 400, rotation: 20 }, n = { ...makeNode('rect', 120, 120), w: 80, h: 40, rotation: 30, parent: f.id }; store.init([f, n]); store.selection.add(n.id);
    const tool = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} }), hs = nodeHandles(store.doc, n), opposite = hs[0], m = worldMatrix(store.doc, n), p = transform(m, { x: 120, y: 70 });
    tool.onPointerDown(hs[4], event()); tool.onPointerMove(p, event()); tool.onPointerUp(p);
    const result = store.doc.get(n.id)!; expect(result.w).toBeCloseTo(120); expect(result.h).toBeCloseTo(70); near(nodeHandles(store.doc, result)[0], opposite);
});
