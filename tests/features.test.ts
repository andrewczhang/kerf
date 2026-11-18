import { describe, expect, it } from 'vitest';
import { applyOp, makeNode, validNode, type Doc } from '../src/shared/doc';
import { validComment, type Comment } from '../src/shared/comments';
import { versionDiff } from '../src/shared/versions';
import { detachOps, expand, instanceNode } from '../src/shared/components';
describe('prototype links', () => {
    it('inherits and overrides validated links on instance layers', () => {
        const main = { ...makeNode('frame', 0, 0), component: true }, child = { ...makeNode('rect', 10, 10), parent: main.id, link: 'destination' };
        const instance = instanceNode(main, 200, 0), doc: Doc = new Map([main, child, instance].map(n => [n.id, n]));
        expect(expand(doc).get(instance.id + '/' + child.id)?.link).toBe('destination');
        applyOp(doc, { t: 'override', id: instance.id, target: child.id, key: 'link', value: 'other' });
        applyOp(doc, { t: 'override', id: instance.id, target: child.id, key: 'link', value: 42 });
        expect(expand(doc).get(instance.id + '/' + child.id)?.link).toBe('other');
        expect(validNode({ ...instance, overrides: { [child.id]: { link: 42 } } })).toBe(false);
        applyOp(doc, { t: 'override', id: instance.id, target: child.id, key: 'link', value: null });
        expect(expand(doc).get(instance.id + '/' + child.id)?.link).toBeNull();
    });
    it('supports old documents, links and clearing a link', () => {
        const n = makeNode('rect', 0, 0), doc: Doc = new Map();
        expect(validNode(n)).toBe(true); applyOp(doc, { t: 'create', node: n });
        for (const value of ['frame-id', null, undefined]) { applyOp(doc, { t: 'set', id: n.id, key: 'link', value }); expect(doc.get(n.id)?.link).toBe(value); }
    });
    it('rejects invalid links for create and set', () => {
        const n = makeNode('rect', 0, 0), doc: Doc = new Map();
        applyOp(doc, { t: 'create', node: { ...n, link: 42 as never } }); expect(doc.size).toBe(0);
        applyOp(doc, { t: 'create', node: n }); applyOp(doc, { t: 'set', id: n.id, key: 'link', value: 42 }); expect(doc.get(n.id)?.link).toBeUndefined();
    });
});
describe('version diff', () => {
    it('deletes reversed nested references before restoring a detached instance', () => {
        const a = { ...makeNode('frame', 0, 0), component: true }, b = { ...makeNode('frame', 300, 0), component: true };
        const leaf = { ...makeNode('rect', 10, 10), parent: b.id }, nested = instanceNode(b, 0, 0, a.id);
        const target: Doc = new Map([a, b, nested, leaf].map(n => [n.id, n])), current = new Map(target);
        for (const op of detachOps(current, nested.id)) applyOp(current, op);
        const reverse = instanceNode(a, 0, 0, b.id);
        applyOp(current, { t: 'create', node: reverse });
        expect(current.has(reverse.id)).toBe(true);
        const ops = versionDiff(current, target), firstWrite = ops.findIndex(op => op.t !== 'delete');
        expect(ops.slice(firstWrite).some(op => op.t === 'delete')).toBe(false);
        for (const op of ops) applyOp(current, op);
        expect(current).toEqual(target);
    });
    it('clears old containment before creating reversed nested references', () => {
        const a = { ...makeNode('frame', 0, 0), component: true }, b = { ...makeNode('frame', 300, 0), component: true };
        const nested = instanceNode(b, 0, 0, a.id), reverse = instanceNode(a, 0, 0, b.id);
        const current: Doc = new Map([a, b, nested].map(n => [n.id, n]));
        const target: Doc = new Map([a, b, reverse, { ...nested, parent: null }].map(n => [n.id, n]));
        const ops = versionDiff(current, target);
        expect(ops[0]).toEqual({ t: 'set', id: nested.id, key: 'parent', value: null });
        for (const op of ops) applyOp(current, op);
        expect(current).toEqual(target);
    });
    it('restores component instances across detach and preserves overrides and children', () => {
        const main = { ...makeNode('frame', 0, 0), component: true }, child = { ...makeNode('rect', 10, 10), parent: main.id };
        const instance = { ...instanceNode(main, 200, 0), overrides: { [child.id]: { fill: '#123456' } } };
        const linked: Doc = new Map([main, child, instance].map(n => [n.id, n])), detached = new Map(linked);
        for (const op of detachOps(detached, instance.id)) applyOp(detached, op);
        const current = new Map(detached);
        for (const op of versionDiff(current, linked)) applyOp(current, op);
        expect(current).toEqual(linked);
        for (const op of versionDiff(current, detached)) applyOp(current, op);
        expect(current).toEqual(detached);
    });
    it('creates, deletes and sets only changed properties', () => {
        const a = makeNode('rect', 0, 0), b = makeNode('ellipse', 5, 9), c = makeNode('rect', 4, 1);
        const from: Doc = new Map([[a.id, a], [b.id, b]]), to: Doc = new Map([[a.id, { ...a, x: 12, link: 'target' }], [c.id, c]]);
        const ops = versionDiff(from, to); expect(ops).toHaveLength(4); for (const op of ops) applyOp(from, op); expect(from).toEqual(to);
    });
    it('handles empty and unchanged docs', () => { expect(versionDiff(new Map(), new Map())).toEqual([]); const n = makeNode('rect', 0, 0), d: Doc = new Map([[n.id, n]]); expect(versionDiff(d, d)).toEqual([]); const ops = versionDiff(d, new Map()); for (const op of ops) applyOp(d, op); expect(d.size).toBe(0); });
    it('preserves surviving descendants when deleting a frame and reparents to new frames', () => {
        const frame = makeNode('frame', 0, 0), child = { ...makeNode('rect', 10, 20), parent: frame.id }, next = makeNode('frame', 200, 0);
        const from: Doc = new Map([[frame.id, frame], [child.id, child]]), to: Doc = new Map([[child.id, { ...child, parent: next.id }], [next.id, next]]);
        for (const op of versionDiff(from, to)) applyOp(from, op); expect(from).toEqual(to);
    });
    it('rejects cyclic snapshot hierarchies', () => { const n = makeNode('frame', 0, 0); n.parent = n.id; expect(() => versionDiff(new Map(), new Map([[n.id, n]]))).toThrow(); });
    it('reparents in one set without redundant temporary writes', () => { const a = makeNode('frame', 0, 0), b = makeNode('frame', 0, 0), n = { ...makeNode('rect', 0, 0), parent: a.id }; const from: Doc = new Map([[a.id, a], [b.id, b], [n.id, n]]), to = new Map(from); to.set(n.id, { ...n, parent: b.id }); expect(versionDiff(from, to)).toEqual([{ t: 'set', id: n.id, key: 'parent', value: b.id }]); });
});
describe('comment validation', () => {
    const c: Comment = { id: 'one', thread: null, x: 0, y: 2, author: 'Sam', color: '#2364df', text: 'Looks good', at: 123 };
    it('accepts roots, pinned comments and replies', () => { expect(validComment(c)).toBe(true); expect(validComment({ ...c, node: 'frame', thread: 'other', resolved: false })).toBe(true); });
    it('rejects empty, malformed or unbounded input', () => { for (const patch of [{ text: '' }, { text: '   ' }, { text: 'x'.repeat(10001) }, { x: Infinity }, { color: 'red' }, { thread: 'one' }, { at: NaN }, { resolved: 'yes' }]) expect(validComment({ ...c, ...patch } as Comment)).toBe(false); expect(validComment(null as never)).toBe(false); });
});
