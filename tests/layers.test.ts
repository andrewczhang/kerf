import { describe, it, expect } from 'vitest';
import { applyOp, between, children, makeNode, validNode, type Doc, type Node, type Op } from '../src/shared/doc';
import { groupOps, moveOps, normalizeGroups, ungroupOps, blocked, outerGroup } from '../src/shared/layers';
import { hit, world } from '../src/shared/geometry';
import { Store } from '../src/client/store';
const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
const apply = (doc: Doc, ops: Op[]) => { for (const op of ops) applyOp(doc, op); };
describe('layers', () => {
    it('groups mixed parents in paint order and preserves world positions through ungroup', () => {
        const f = makeNode('frame', 200, 300), a = makeNode('rect', 10, 20), b = { ...makeNode('ellipse', 30, 40), parent: f.id };
        f.index = between(a.index); const doc = docOf(a, f, b), before = [world(doc, a), world(doc, b)];
        const ops = groupOps(doc, [b.id, a.id]); apply(doc, ops); const g = [...doc.values()].find(n => n.type === 'group')!;
        expect(g.parent).toBe(f.id); expect(g.index).toBe(b.index); expect(children(doc, g.id).map(n => n.id)).toEqual([a.id, b.id]);
        expect([world(doc, doc.get(a.id)!), world(doc, doc.get(b.id)!)]).toEqual(before);
        apply(doc, ungroupOps(doc, g.id)); expect(doc.has(g.id)).toBe(false); expect(doc.has(a.id)).toBe(true); expect(doc.get(b.id)?.parent).toBe(f.id);
        expect([world(doc, doc.get(a.id)!), world(doc, doc.get(b.id)!)]).toEqual(before);
    });
    it('normalizes nested group bounds without moving children in world space', () => {
        const g = makeNode('group', 100, 200), inner = { ...makeNode('group', 20, 30), parent: g.id }, a = { ...makeNode('rect', -40, 50), parent: inner.id };
        const doc = docOf(g, inner, a), before = world(doc, a); apply(doc, normalizeGroups(doc));
        expect(world(doc, doc.get(a.id)!)).toEqual(before); expect(doc.get(g.id)?.x).toBe(80); expect(doc.get(g.id)?.w).toBe(100); expect(normalizeGroups(doc)).toEqual([]);
    });
    it('reorders and reparents with fractional indexes and world position preservation', () => {
        const a = makeNode('rect', 20, 30), b = { ...makeNode('ellipse', 1, 2), index: between(a.index) }, f = makeNode('frame', 200, 300), doc = docOf(a, b, f);
        apply(doc, moveOps(doc, a.id, null, { afterId: b.id })); expect(doc.get(a.id)!.index > b.index).toBe(true);
        const before = world(doc, doc.get(a.id)!); apply(doc, moveOps(doc, a.id, f.id)); expect(world(doc, doc.get(a.id)!)).toEqual(before);
        apply(doc, moveOps(doc, a.id, null, { beforeId: b.id })); expect(doc.get(a.id)!.index < b.index).toBe(true);
    });
    it('rejects cycles, leaves, missing parents and invalid sibling targets', () => {
        const g = makeNode('group', 0, 0), f = { ...makeNode('frame', 0, 0), parent: g.id }, a = makeNode('rect', 0, 0), doc = docOf(g, f, a);
        for (const parent of [g.id, f.id, a.id, 'missing']) expect(moveOps(doc, g.id, parent)).toEqual([]);
        expect(moveOps(doc, a.id, null, { beforeId: 'missing' })).toEqual([]);
        expect(groupOps(doc, [])).toEqual([]); expect(ungroupOps(doc, a.id)).toEqual([]); expect(normalizeGroups(new Map())).toEqual([]);
        apply(doc, ungroupOps(docOf(g), g.id)); expect(doc.has(g.id)).toBe(false);
    });
    it('filters selected descendants and undoes grouping as one transaction', () => {
        const f = makeNode('frame', 0, 0), a = { ...makeNode('rect', 10, 20), parent: f.id }, store = new Store(); store.init([f, a]);
        store.begin(); store.commit(groupOps(store.doc, [f.id, a.id])); store.end(); expect([...store.doc.values()].filter(n => n.type === 'group')).toHaveLength(1);
        store.history(); expect(store.doc.size).toBe(2); expect(store.doc.get(a.id)?.parent).toBe(f.id); store.history(true); expect(store.doc.size).toBe(3);
    });
    it('normalizes legacy nodes and accepts only boolean flags', () => {
        const n = makeNode('rect', 0, 0); const old = { ...n } as Partial<Node>; delete old.hidden; delete old.locked;
        expect(validNode(old as Node)).toBe(true); const doc: Doc = new Map(); apply(doc, [{ t: 'create', node: old as Node }]); expect(doc.get(n.id)?.hidden).toBe(false);
        apply(doc, [{ t: 'set', id: n.id, key: 'hidden', value: true }]); expect(doc.get(n.id)?.hidden).toBe(true);
        expect(validNode({ ...n, locked: 'yes' } as unknown as Node)).toBe(false);
    });
    it('ignores hidden and locked ancestors during hit testing and resolves outer groups', () => {
        const g = makeNode('group', 0, 0), a = { ...makeNode('rect', 0, 0), parent: g.id }, doc = docOf(g, a);
        expect(outerGroup(doc, a).id).toBe(g.id); expect(hit(doc, { x: 5, y: 5 })?.id).toBe(a.id);
        doc.set(g.id, { ...g, locked: true }); expect(hit(doc, { x: 5, y: 5 })).toBeUndefined(); expect(blocked(doc, a)).toBe(true);
        doc.set(g.id, { ...g, hidden: true }); expect(hit(doc, { x: 5, y: 5 })).toBeUndefined();
    });
});
