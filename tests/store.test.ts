import { it, expect } from 'vitest';
import { Store } from '../src/client/store';
import { makeNode } from '../src/shared/doc';
import type { Op } from '../src/shared/doc';
import { componentOps, detachOps, expand, instanceNode } from '../src/shared/components';
it('chunks large commits into independently acked batches without splitting history', () => {
    const s = new Store(), batches: { ops: Op[]; seq: number }[] = [];
    s.send = (ops, seq) => batches.push({ ops, seq });
    s.commit(Array.from({ length: 2001 }, () => ({ t: 'create', node: makeNode('rect', 0, 0) })));
    expect(batches.map(b => b.ops.length)).toEqual([1000, 1000, 1]);
    expect(batches.map(b => b.seq)).toEqual([1, 2, 3]);
    expect(s.undoStack).toHaveLength(1);
    s.pending.delete(1); expect(s.pending.size).toBe(2);
    s.init([...s.doc.values()]); expect(s.doc.size).toBe(2001);
    s.history(); expect(s.doc.size).toBe(0);
    expect(batches.every(b => b.ops.length <= 1000)).toBe(true);
    expect(s.pending.size).toBe(5);
});
it('undoes an entire drag and redoes it', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.commit([{ t: 'create', node: n }]); s.begin(); s.set(n.id, { x: 1 }); s.set(n.id, { x: 2 }); s.set(n.id, { x: 3 }); s.end(); s.history(); expect(s.doc.get(n.id)?.x).toBe(0); s.history(true); expect(s.doc.get(n.id)?.x).toBe(3); });
it('does not undo a remote property overwrite', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.commit([{ t: 'create', node: n }]); s.set(n.id, { x: 20, y: 30 }); s.pending.clear(); s.remote([{ t: 'set', id: n.id, key: 'x', value: 99 }]); s.history(); expect(s.doc.get(n.id)?.x).toBe(99); expect(s.doc.get(n.id)?.y).toBe(0); });
it('protects pending properties and reapplies pending on init', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.init([n]); s.set(n.id, { x: 20 }); s.remote([{ t: 'set', id: n.id, key: 'x', value: 99 }]); expect(s.doc.get(n.id)?.x).toBe(20); s.init([n]); expect(s.doc.get(n.id)?.x).toBe(20); });
it('undoes frame deletion with descendants and handles empty history', () => { const s = new Store(), a = makeNode('frame', 0, 0), b = { ...makeNode('rect', 10, 10), parent: a.id }; s.history(); s.commit([{ t: 'create', node: a }, { t: 'create', node: b }]); s.commit([{ t: 'delete', id: a.id }]); s.history(); expect(s.doc.size).toBe(2); });
it('redoes a shape creation and drag as one transaction', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.begin(); s.commit([{ t: 'create', node: n }]); s.set(n.id, { w: 250, h: 150 }); s.end(); s.history(); expect(s.doc.size).toBe(0); s.history(true); expect(s.doc.get(n.id)?.w).toBe(250); expect(s.doc.get(n.id)?.h).toBe(150); });
it('groups override edits and undoes and redoes set, clear and previous values', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true }, instance = instanceNode(main, 200, 0);
    s.init([main, instance]);
    const op = { t: 'override' as const, id: instance.id, target: '', key: 'fill' as const, value: '#112233' };
    s.begin(); s.commit([op]); s.commit([{ ...op, value: '#445566' }]); s.end();
    s.history(); expect(s.doc.get(instance.id)?.overrides).toEqual({});
    s.history(true); expect(expand(s.doc).get(instance.id)?.fill).toBe('#445566');
    s.commit([{ ...op, clear: true }]);
    s.history(); expect(expand(s.doc).get(instance.id)?.fill).toBe('#445566');
    s.history(true); expect(s.doc.get(instance.id)?.overrides).toEqual({});
});
it('protects pending override targets independently and skips remotely overwritten history', () => {
    const s = new Store(), main = makeNode('frame', 0, 0), instance = instanceNode(main, 200, 0);
    s.init([main, instance]);
    const op = { t: 'override' as const, id: instance.id, target: 'child', key: 'fill' as const, value: '#112233' };
    s.commit([op]);
    s.remote([{ ...op, value: '#445566' }, { ...op, target: '', value: '#778899' }]);
    expect(s.doc.get(instance.id)?.overrides).toEqual({ child: { fill: '#112233' }, '': { fill: '#778899' } });
    s.init([main, instance]); expect(s.doc.get(instance.id)?.overrides?.child.fill).toBe('#112233');
    s.pending.clear(); s.remote([{ ...op, value: '#aabbcc' }]); s.history();
    expect(s.doc.get(instance.id)?.overrides?.child.fill).toBe('#aabbcc');
});
it('follows main resize in the same transaction without changing customized instance sizes', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true }, a = instanceNode(main, 200, 0), b = { ...instanceNode(main, 400, 0), w: 150 };
    s.init([main, a, b]); s.set(main.id, { w: 220 });
    expect(s.doc.get(a.id)?.w).toBe(220); expect(s.doc.get(b.id)?.w).toBe(150);
    expect([...s.pending.values()][0]).toHaveLength(2);
    s.history(); expect(s.doc.get(a.id)?.w).toBe(100); expect(s.doc.get(main.id)?.w).toBe(100);
    s.history(true); expect(s.doc.get(a.id)?.w).toBe(220);
});
it('undoes component wrapping and detach without losing children', () => {
    const s = new Store(), a = makeNode('rect', 0, 0), b = makeNode('rect', 150, 0);
    s.init([a, b]); const { ops, id } = componentOps.create(s.doc, [a.id, b.id]); s.commit(ops);
    s.history(); expect(s.doc.size).toBe(2); expect(s.doc.get(a.id)?.parent).toBeNull();
    s.history(true); expect(s.doc.get(a.id)?.parent).toBe(id);
    const instance = instanceNode(s.doc.get(id)!, 0, 200); s.commit([{ t: 'create', node: instance }]);
    s.commit(detachOps(s.doc, instance.id)); expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
    s.history(); expect(s.doc.get(instance.id)?.instanceOf).toBe(id);
    s.history(true); expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
});
it('ignores invalid overrides and empty transactions without recording or sending them', () => {
    const s = new Store(), n = makeNode('rect', 0, 0); s.init([n]);
    s.commit([]); s.commit([{ t: 'override', id: n.id, target: '', key: 'fill', value: '#112233' }]);
    expect(s.undoStack).toHaveLength(0); expect(s.pending.size).toBe(0);
});
