import { expect, it } from 'vitest';
import { applyOp, makeNode, validNode, type Doc, type Node } from '../src/shared/doc';
import { hit, maskContains, transform, worldMatrix } from '../src/shared/geometry';
import { containsPath, corner } from '../src/shared/path';
import { maskOps } from '../src/shared/layers';
import { exportBounds, exportSVG } from '../src/client/export';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
const mask = (type: 'rect' | 'ellipse' = 'rect'): Node => ({ ...makeNode(type, 0, 0, 'A'), mask: true });

it('rotates mask hits, SVG clips and export bounds with the mask world matrix', () => {
    const m = { ...mask(), w: 100, h: 20, rotation: 90 }, n = { ...makeNode('rect', -100, -100, 'B'), w: 300, h: 300 }, doc = docOf(m, n);
    expect(hit(doc, { x: 50, y: 50 })?.id).toBe(n.id);
    expect(hit(doc, { x: 10, y: 10 })).toBeUndefined();
    expect(hit(docOf(m), { x: 50, y: 50 })?.id).toBe(m.id);
    expect(exportBounds(doc, [n])).toEqual({ x: 40, y: -40, w: 20, h: 100 });
    expect(exportSVG(doc, [n.id])).toMatch(/<clipPath id="mask-\d+"><rect[^>]*transform="matrix\(0 1 -1 0 60 -40\)"/);
    const frame = { ...makeNode('frame', 200, 150), rotation: 30 }, nested = { ...m, parent: frame.id }, child = { ...n, parent: frame.id }, nestedDoc = docOf(frame, nested, child);
    const inside = transform(worldMatrix(nestedDoc, nested), { x: 80, y: 10 }), outside = transform(worldMatrix(nestedDoc, nested), { x: 80, y: 40 });
    expect(hit(nestedDoc, inside, frame.id)?.id).toBe(child.id);
    expect(hit(nestedDoc, outside, frame.id)).toBeUndefined();
    expect(exportSVG(nestedDoc, [frame.id])).toMatch(/<clipPath id="mask-\d+"><rect[^>]*transform="matrix\(/);
});

it('excludes rounded mask corners and clamps the radius to its dimensions', () => {
    const m = { ...mask(), radius: 1000, w: 100, h: 60 }, n = makeNode('rect', 0, 0, 'B'), doc = docOf(m, n);
    expect(hit(doc, { x: 1, y: 1 })).toBeUndefined();
    expect(hit(doc, { x: 30, y: 0 })?.id).toBe(n.id);
    expect(hit(doc, { x: 10, y: 10 })?.id).toBe(n.id);
    expect(maskContains(doc, { ...m, radius: 0 }, { x: 0, y: 0 })).toBe(true);
    expect(maskContains(doc, m, { x: -1, y: 30 })).toBe(false);
});

it('uses nonzero winding for overlapping closed-path masks', () => {
    const points = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => corner(x, y));
    const m = { ...makeNode('path', 0, 0, 'A'), points, closed: true, mask: true }, n = makeNode('rect', 0, 0, 'B');
    expect(hit(docOf(m, n), { x: 50, y: 50 })?.id).toBe(n.id);
    expect(hit(docOf(m), { x: 50, y: 50 })?.id).toBe(m.id);
    expect(containsPath([], { x: 0, y: 0 })).toBe(false);
    expect(maskContains(docOf(m), m, { x: 150, y: 50 })).toBe(false);
    const reversed = { ...m, points: [...points].reverse() };
    expect(maskContains(docOf(reversed), reversed, { x: 50, y: 50 })).toBe(true);
    const cancelled = { ...m, points: [...points.slice(0, 5), ...points.slice(0, 4).reverse()] };
    expect(maskContains(docOf(cancelled), cancelled, { x: 50, y: 50 })).toBe(false);
});

it('validates masks and drops sets that invalidate their geometry', () => {
    const n = mask(), doc = docOf(n);
    expect(validNode(n)).toBe(true);
    expect(validNode({ ...n, mask: 'yes' } as unknown as Node)).toBe(false);
    for (const type of ['group', 'frame', 'text', 'path'] as const) expect(validNode({ ...makeNode(type, 0, 0), mask: true })).toBe(false);
    applyOp(doc, { t: 'set', id: n.id, key: 'type', value: 'group' });
    expect(doc.get(n.id)?.type).toBe('rect');
    applyOp(doc, { t: 'set', id: n.id, key: 'mask', value: false });
    expect(doc.get(n.id)?.mask).toBe(false);
    const path = { ...makeNode('path', 0, 0), closed: true, mask: true };
    expect(validNode(path)).toBe(true);
    const paths = docOf(path); applyOp(paths, { t: 'set', id: path.id, key: 'closed', value: false });
    expect(paths.get(path.id)?.closed).toBe(true);
});

for (const type of ['rect', 'ellipse'] as const) it(`clips hits to a ${type} mask, including descendants`, () => {
    const m = mask(type), g = { ...makeNode('group', 0, 0, 'B'), w: 200 }, n = { ...makeNode('rect', 0, 0), parent: g.id, w: 200 };
    const doc = docOf(m, g, n);
    expect(hit(doc, { x: 50, y: 50 })?.id).toBe(n.id);
    expect(hit(doc, { x: 150, y: 50 })).toBeUndefined();
    if (type === 'ellipse') expect(hit(doc, { x: 1, y: 1 })).toBeUndefined();
    expect(hit(docOf(m), { x: 50, y: 50 })?.id).toBe(m.id);
    expect(hit(docOf({ ...m, hidden: true }, { ...n, parent: null }), { x: 150, y: 50 })?.id).toBe(n.id);
});

it('ends the previous mask at the next visible mask', () => {
    const a = mask(), b = { ...mask('ellipse'), x: 200, index: 'B' }, n = { ...makeNode('rect', 0, 0, 'C'), w: 400 };
    expect(hit(docOf(a, b, n), { x: 250, y: 50 })?.id).toBe(n.id);
    expect(hit(docOf(a, b, n), { x: 50, y: 50 })?.id).toBe(a.id);
    expect(hit(docOf(a, b), { x: 250, y: 50 })?.id).toBe(b.id);
});

it('exports mask geometry without painting it, clipping selected roots too', () => {
    const m = mask('ellipse'), n = { ...makeNode('rect', -50, -50, 'B'), w: 300, h: 300 }, doc = docOf(m, n);
    const svg = exportSVG(doc, [n.id]);
    expect(svg).toContain('<clipPath id="mask-'); expect(svg).toContain('<ellipse');
    expect(svg).not.toContain(`id="${m.id}"`);
    expect(exportBounds(doc, [n])).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    const g = makeNode('group', 0, 0); m.parent = g.id; n.parent = g.id; doc.set(g.id, g);
    expect(exportSVG(doc, [g.id])).toContain('<clipPath id="mask-');
    expect(exportBounds(doc, [g])).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(exportBounds(docOf(m), [m])).toEqual({ x: 0, y: 0, w: 100, h: 100 });
});

it('builds one group transaction or toggles a single eligible mask', () => {
    const a = mask(), b = makeNode('text', 0, 0, 'B'), doc = docOf(a, b);
    const ops = maskOps(doc, [b.id, a.id]); expect(ops.filter(op => op.t === 'create')).toHaveLength(1);
    for (const op of ops) applyOp(doc, op);
    expect(doc.get(a.id)?.mask).toBe(true); expect(doc.get(a.id)?.parent).toBe(doc.get(b.id)?.parent);
    expect(maskOps(doc, [a.id])).toEqual([{ t: 'set', id: a.id, key: 'mask', value: false }]);
    expect(maskOps(doc, [])).toEqual([]); expect(maskOps(doc, [b.id])).toEqual([]);
    expect(maskOps(docOf({ ...b, index: 'A' }, { ...a, index: 'B' }), [a.id, b.id])).toEqual([]);
});
