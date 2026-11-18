import { it, expect } from 'vitest';
import { Store } from '../src/client/store';
import { applyOp, makeNode, type Op } from '../src/shared/doc';
import { groupOps } from '../src/shared/layers';
import { MAX_OPS } from '../src/shared/protocol';

it('chunks large grouping transactions with independent pending sequences and one undo step', () => {
    const s = new Store(), nodes = Array.from({ length: 250 }, (_, i) => ({ ...makeNode('rect', i, i), index: String(i).padStart(4, '0') }));
    s.init(nodes); const ops = groupOps(s.doc, nodes.map(n => n.id)), sent: { ops: Op[]; seq: number }[] = [];
    s.send = (ops, seq) => sent.push({ ops, seq }); s.begin(); s.commit(ops); s.end();
    expect(ops.length).toBeGreaterThan(MAX_OPS);
    expect(sent.flatMap(m => m.ops)).toEqual(ops);
    expect(sent.every(m => m.ops.length > 0 && m.ops.length <= MAX_OPS)).toBe(true);
    expect(new Set(sent.map(m => m.seq)).size).toBe(sent.length);
    const server = new Map(nodes.map(n => [n.id, n]));
    for (const m of sent) { expect(s.pending.get(m.seq)).toEqual(m.ops); for (const op of m.ops) applyOp(server, op); s.pending.delete(m.seq); }
    expect(server).toEqual(s.doc); expect(s.pending.size).toBe(0); expect(s.undoStack).toHaveLength(1);
    s.history(); expect(s.doc).toEqual(new Map(nodes.map(n => [n.id, n])));
});

it('does not send empty batches and splits only beyond the exact server limit', () => {
    for (const count of [0, 1, MAX_OPS, MAX_OPS + 1]) {
        const s = new Store(), n = makeNode('rect', 0, 0), lengths: number[] = []; s.init([n]); s.send = ops => lengths.push(ops.length);
        s.commit(Array.from({ length: count }, (_, value) => ({ t: 'set', id: n.id, key: 'x', value })));
        expect(lengths).toEqual(count === 0 ? [] : count <= MAX_OPS ? [count] : [MAX_OPS, 1]);
        expect(s.pending.size).toBe(lengths.length);
    }
});

it('keeps later chunks pending after an earlier chunk ack and replays them on reconnect', () => {
    const s = new Store(), n = makeNode('rect', 0, 0); s.init([n]);
    s.commit([...Array.from({ length: MAX_OPS }, (_, value): Op => ({ t: 'set', id: n.id, key: 'x', value })), { t: 'set', id: n.id, key: 'y', value: 42 }]);
    s.pending.delete(1); s.remote([{ t: 'set', id: n.id, key: 'x', value: 5 }, { t: 'set', id: n.id, key: 'y', value: 99 }]);
    expect(s.doc.get(n.id)?.x).toBe(5); expect(s.doc.get(n.id)?.y).toBe(42);
    s.init([{ ...n, x: 5 }]); expect(s.doc.get(n.id)?.y).toBe(42);
    s.pending.delete(2); s.remote([{ t: 'set', id: n.id, key: 'y', value: 99 }]); expect(s.doc.get(n.id)?.y).toBe(99);
});
it('undoes an entire drag and redoes it', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.commit([{ t: 'create', node: n }]); s.begin(); s.set(n.id, { x: 1 }); s.set(n.id, { x: 2 }); s.set(n.id, { x: 3 }); s.end(); s.history(); expect(s.doc.get(n.id)?.x).toBe(0); s.history(true); expect(s.doc.get(n.id)?.x).toBe(3); });
it('does not undo a remote property overwrite', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.commit([{ t: 'create', node: n }]); s.set(n.id, { x: 20, y: 30 }); s.pending.clear(); s.remote([{ t: 'set', id: n.id, key: 'x', value: 99 }]); s.history(); expect(s.doc.get(n.id)?.x).toBe(99); expect(s.doc.get(n.id)?.y).toBe(0); });
it('protects pending properties and reapplies pending on init', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.init([n]); s.set(n.id, { x: 20 }); s.remote([{ t: 'set', id: n.id, key: 'x', value: 99 }]); expect(s.doc.get(n.id)?.x).toBe(20); s.init([n]); expect(s.doc.get(n.id)?.x).toBe(20); });
it('undoes frame deletion with descendants and handles empty history', () => { const s = new Store(), a = makeNode('frame', 0, 0), b = { ...makeNode('rect', 10, 10), parent: a.id }; s.history(); s.commit([{ t: 'create', node: a }, { t: 'create', node: b }]); s.commit([{ t: 'delete', id: a.id }]); s.history(); expect(s.doc.size).toBe(2); });
it('redoes a shape creation and drag as one transaction', () => { const s = new Store(), n = makeNode('rect', 0, 0); s.begin(); s.commit([{ t: 'create', node: n }]); s.set(n.id, { w: 250, h: 150 }); s.end(); s.history(); expect(s.doc.size).toBe(0); s.history(true); expect(s.doc.get(n.id)?.w).toBe(250); expect(s.doc.get(n.id)?.h).toBe(150); });
