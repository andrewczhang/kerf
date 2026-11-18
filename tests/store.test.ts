import { it, expect } from 'vitest';
import { Store } from '../src/client/store';
import { applyOp, makeNode, strokeOptions, type Op } from '../src/shared/doc';
import { groupOps } from '../src/shared/layers';
import { MAX_OPS } from '../src/shared/protocol';
it('sends large commits in ordered batches of at most 1000 with separate pending sequences', () => {
    const s = new Store(), n = makeNode('rect', 0, 0), sent: { ops: Op[]; seq: number }[] = [];
    s.init([n]); s.send = (ops, seq) => sent.push({ ops, seq });
    s.commit([]); expect(sent).toHaveLength(0); expect(s.pending.size).toBe(0);
    const ops: Op[] = Array.from({ length: 2500 }, (_, i) => ({ t: 'set', id: n.id, key: 'x', value: i + 1 }));
    s.commit(ops);
    expect(sent.map(batch => batch.ops.length)).toEqual([1000, 1000, 500]);
    expect(sent.map(batch => batch.seq)).toEqual([1, 2, 3]);
    expect(sent.flatMap(batch => batch.ops)).toEqual(ops);
    expect([...s.pending]).toEqual(sent.map(batch => [batch.seq, batch.ops]));
    expect(s.doc.get(n.id)?.x).toBe(2500); expect(s.undoStack).toHaveLength(1);
    sent.length = 0; s.history();
    expect(sent.map(batch => batch.ops.length)).toEqual([1000, 1000, 500]);
    expect(sent.map(batch => batch.seq)).toEqual([4, 5, 6]); expect(s.doc.get(n.id)?.x).toBe(0);
});

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

it('syncs stroke properties independently and undoes them back to legacy defaults', () => {
    const local = new Store(), remote = new Store(), n = makeNode('path', 0, 0);
    local.init([n]); remote.init([n]);
    local.send = ops => remote.remote(JSON.parse(JSON.stringify(ops)));
    local.begin(); local.set(n.id, { strokeDash: 6, strokeGap: 2, strokeCap: 'square', strokeEnd: 'bar' }); local.end();
    expect(strokeOptions(remote.doc.get(n.id)!)).toMatchObject({ strokeDash: 6, strokeGap: 2, strokeCap: 'square', strokeEnd: 'bar' });
    local.history();
    expect(strokeOptions(remote.doc.get(n.id)!)).toEqual(strokeOptions(n));
    local.history(true);
    remote.remote([{ t: 'set', id: n.id, key: 'strokeGap', value: -1 }, { t: 'set', id: n.id, key: 'strokeMiterLimit', value: 0 }]);
    expect(strokeOptions(remote.doc.get(n.id)!)).toEqual(strokeOptions(local.doc.get(n.id)!));
});
it('redoes the live shape including a peer resize after local creation', () => {
    const author = new Store(), peer = new Store(), n = makeNode('rect', 0, 0);
    const connect = (from: Store, to: Store) => { from.send = (ops, seq) => { to.remote(ops); from.pending.delete(seq); }; };
    connect(author, peer); connect(peer, author);
    author.begin(); author.commit([{ t: 'create', node: n }]); author.set(n.id, { w: 193, h: 144 }); author.end();
    peer.set(n.id, { w: 250 });
    author.history(); expect(author.doc.has(n.id)).toBe(false); expect(peer.doc.has(n.id)).toBe(false);
    author.history(true);
    expect(author.doc.get(n.id)).toMatchObject({ w: 250, h: 144 });
    expect(peer.doc.get(n.id)).toEqual(author.doc.get(n.id));
});
