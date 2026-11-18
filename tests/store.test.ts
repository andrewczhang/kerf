import { it, expect } from 'vitest';
import { Store } from '../src/client/store';
import { makeNode, strokeOptions } from '../src/shared/doc';
import type { Op } from '../src/shared/doc';
import { componentOps, detachOps, expand, instanceNode } from '../src/shared/components';
import { applyOp } from '../src/shared/doc';
import { groupOps, ungroupOps } from '../src/shared/layers';
import { MAX_OPS } from '../src/shared/protocol';
it('freezes the rendered instance size when inherited Hug sizing becomes a Fixed override', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true, layout: 'horizontal' as const, sizeW: 'hug' as const, sizeH: 'hug' as const };
    const child = { ...makeNode('rect', 0, 0), parent: main.id, w: 80, h: 30 }, instance = instanceNode(main, 200, 0);
    s.init([main, child, instance]);
    expect(s.doc.get(instance.id)).toMatchObject({ w: 100, h: 100 });
    expect(expand(s.doc).get(instance.id)).toMatchObject({ w: 80, h: 30 });
    s.set(instance.id, { sizeW: 'fixed', sizeH: 'fixed' });
    expect(s.doc.get(instance.id)).toMatchObject({ w: 80, h: 30 });
    expect(expand(s.doc).get(instance.id)).toMatchObject({ w: 80, h: 30, sizeW: 'fixed', sizeH: 'fixed' });
    expect(s.undoStack).toHaveLength(1);
    s.history(); expect(expand(s.doc).get(instance.id)).toMatchObject({ w: 80, h: 30, sizeW: 'hug', sizeH: 'hug' });
    s.history(true); expect(expand(s.doc).get(instance.id)).toMatchObject({ w: 80, h: 30, sizeW: 'fixed', sizeH: 'fixed' });
});
it('preserves explicit dimensions and ignores invalid sizing overrides while freezing instances', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true, layout: 'horizontal' as const, sizeW: 'hug' as const };
    const child = { ...makeNode('rect', 0, 0), parent: main.id, w: 80 }, instance = instanceNode(main, 200, 0);
    s.init([main, child, instance]);
    s.commit([{ t: 'override', id: instance.id, target: '', key: 'sizeW', value: 'fixed' }, { t: 'set', id: instance.id, key: 'w', value: 140 }]);
    expect(expand(s.doc).get(instance.id)?.w).toBe(140);
    const before = s.doc.get(main.id), count = s.undoStack.length;
    s.commit([{ t: 'override', id: main.id, target: '', key: 'sizeW', value: 'fixed' }]);
    expect(s.doc.get(main.id)).toBe(before); expect(s.undoStack).toHaveLength(count);
});
it('inherits paints and resolves layout and virtual effect edits as overrides', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true, layout: 'horizontal' as const, gap: 5 };
    const a = { ...makeNode('rect', 0, 0, 'A'), parent: main.id, w: 10 }, b = { ...makeNode('rect', 0, 0, 'B'), parent: main.id, w: 20 };
    const instance = instanceNode(main, 200, 0), paint = { type: 'solid' as const, color: '#123456', opacity: 1, visible: true };
    s.init([main, a, b, instance]); s.set(main.id, { fills: [paint] });
    expect(expand(s.doc).get(instance.id)?.fills).toEqual([paint]);
    s.commit([{ t: 'set', id: instance.id, key: 'gap', value: 10 }]);
    expect(expand(s.doc).get(instance.id + '/' + b.id)?.x).toBe(20);
    expect(s.doc.get(b.id)?.x).toBe(15);
    const effect = { type: 'layer-blur' as const, radius: 2, visible: true };
    s.set(instance.id + '/' + a.id, { effects: [effect] });
    expect(expand(s.doc).get(instance.id + '/' + a.id)?.effects).toEqual([effect]);
    expect(s.doc.get(a.id)?.effects).toBeUndefined();
    s.set(instance.id, { fills: [{ ...paint, color: '#abcdef' }] });
    expect(expand(s.doc).get(instance.id)?.fills?.[0]).toMatchObject({ color: '#abcdef' });
    s.history(); expect(expand(s.doc).get(instance.id)?.fills).toEqual([paint]);
});
it('keeps a surviving main linked through ungroup, undo and redo', () => {
    const s = new Store(), group = makeNode('group', 0, 0), main = { ...makeNode('frame', 10, 10), parent: group.id, component: true };
    const child = { ...makeNode('rect', 5, 5), parent: main.id }, instance = instanceNode(main, 200, 0, null, 'z');
    s.init([group, main, child, instance]);
    s.commit(ungroupOps(s.doc, group.id));
    expect(s.doc.has(group.id)).toBe(false); expect(s.doc.get(main.id)?.parent).toBeNull();
    expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
    expect(s.undoStack).toHaveLength(1);
    s.remote([{ t: 'set', id: child.id, key: 'fill', value: '#123456' }]);
    expect(expand(s.doc).get(instance.id + '/' + child.id)?.fill).toBe('#123456');
    s.history(); expect(s.doc.get(main.id)?.parent).toBe(group.id);
    expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
    s.history(true); expect(s.doc.get(main.id)?.parent).toBeNull();
    expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
});
it('keeps a main linked when undoing and redoing group creation', () => {
    const s = new Store(), main = { ...makeNode('frame', 10, 10), component: true }, instance = instanceNode(main, 200, 0);
    s.init([main, instance]); s.commit(groupOps(s.doc, [main.id]));
    const group = s.doc.get(main.id)!.parent!; expect(s.doc.get(group)?.type).toBe('group');
    s.history(); expect(s.doc.has(group)).toBe(false); expect(s.doc.get(main.id)?.parent).toBeNull();
    expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
    s.remote([{ t: 'set', id: main.id, key: 'fill', value: '#abcdef' }]);
    expect(expand(s.doc).get(instance.id)?.fill).toBe('#abcdef');
    s.history(true); expect(s.doc.get(main.id)?.parent).toBe(group);
    expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
    expect(expand(s.doc).get(instance.id)?.fill).toBe('#abcdef');
});
it('detaches when a rejected move leaves the main inside a deleted ancestor', () => {
    const s = new Store(), group = makeNode('group', 0, 0), main = { ...makeNode('frame', 10, 10), parent: group.id, component: true };
    const instance = instanceNode(main, 200, 0), rect = makeNode('rect', 400, 0);
    s.init([group, main, instance, rect]);
    s.commit([{ t: 'set', id: main.id, key: 'parent', value: rect.id }, { t: 'delete', id: group.id }]);
    expect(s.doc.has(main.id)).toBe(false); expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
    s.history(); expect(s.doc.get(main.id)?.parent).toBe(group.id);
    expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
});
it('resolves inherited instance properties live and clears undone links for late joiners', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true, radius: 8, opacity: .5, fill: '#123456' };
    s.init([main]); s.set(main.id, { link: 'destination' });
    const instance = instanceNode(s.doc.get(main.id)!, 200, 0);
    expect(instance).not.toHaveProperty('link');
    expect(instance).not.toHaveProperty('component');
    expect(instance).not.toHaveProperty('overrides');
    s.remote([{ t: 'create', node: instance }]);
    expect(expand(s.doc).get(instance.id)).toMatchObject({ link: 'destination', radius: 8, opacity: .5, fill: '#123456' });
    s.history(); expect(expand(s.doc).get(instance.id)?.link).toBeUndefined();
    const late = new Store(); late.init(JSON.parse(JSON.stringify([...s.doc.values()])));
    expect(late.doc.get(instance.id)).not.toHaveProperty('link');
    expect(expand(late.doc).get(instance.id)?.link).toBeUndefined();
    s.history(true); expect(expand(s.doc).get(instance.id)?.link).toBe('destination');
    s.commit([{ t: 'override', id: instance.id, target: '', key: 'link', value: 'custom' }]);
    s.set(main.id, { link: null });
    expect(expand(s.doc).get(instance.id)?.link).toBe('custom');
});
it('keeps references valid after unmarking and detaches them when their source is deleted', () => {
    const s = new Store(), main = makeNode('frame', 0, 0), child = { ...makeNode('rect', 10, 10), parent: main.id };
    s.init([main, child]); s.commit(componentOps.create(s.doc, [main.id]).ops);
    const instance = instanceNode(main, 200, 0); s.remote([{ t: 'create', node: instance }]);
    s.history();
    expect(s.doc.get(main.id)?.component).toBeUndefined();
    expect(expand(s.doc).get(instance.id + '/' + child.id)?.fill).toBe(child.fill);
    s.set(main.id, { component: false });
    expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
    s.commit([{ t: 'delete', id: main.id }]);
    expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
    expect([...s.doc.values()].filter(n => n.parent === instance.id)).toHaveLength(1);
    s.history(); expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
    expect(s.doc.get(main.id)?.component).toBe(false);
    s.history(true); expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
});
it('composes nested detaches sharing enclosing overrides in one undo step', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true };
    const child = { ...makeNode('rect', 0, 0), parent: main.id }, outer = { ...makeNode('frame', 0, 0), component: true };
    const a = instanceNode(main, 0, 0, outer.id), b = instanceNode(main, 100, 0, outer.id);
    const parent = { ...instanceNode(outer, 300, 0), overrides: { [a.id + '/' + child.id]: { fill: '#123456' }, [b.id + '/' + child.id]: { fill: '#abcdef' } } };
    s.init([main, child, outer, a, b, parent]);
    expect(detachOps(s.doc, [])).toEqual([]);
    expect(detachOps(s.doc, ['missing', main.id])).toEqual([]);
    s.commit(detachOps(s.doc, [a.id, b.id, a.id]));
    const overrides = s.doc.get(parent.id)!.overrides!;
    expect(Object.keys(overrides)).toHaveLength(2);
    expect(Object.keys(overrides).every(key => !key.includes('/'))).toBe(true);
    const resolved = expand(s.doc);
    for (const [key, value] of Object.entries(overrides)) expect(resolved.get(parent.id + '/' + key)?.fill).toBe(value.fill);
    expect(s.undoStack).toHaveLength(1);
    s.history(); expect(s.doc.get(parent.id)?.overrides).toEqual(parent.overrides);
    s.history(true); expect(s.doc.get(parent.id)?.overrides).toEqual(overrides);
});
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
it('detaches collaborator instances when undo deletes a wrapped main and restores them on redo', () => {
    const s = new Store(), a = makeNode('rect', 0, 0), b = makeNode('rect', 150, 0);
    s.init([a, b]); const { ops, id } = componentOps.create(s.doc, [a.id, b.id]); s.commit(ops);
    const instance = instanceNode(s.doc.get(id)!, 300, 0);
    s.remote([{ t: 'create', node: instance }]);
    s.history();
    expect(s.doc.has(id)).toBe(false); expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
    expect([...s.doc.values()].filter(n => n.parent === instance.id)).toHaveLength(2);
    expect(s.doc.get(a.id)?.parent).toBeNull();
    s.history(true); expect(s.doc.get(instance.id)?.instanceOf).toBe(id);
    expect(s.doc.get(a.id)?.parent).toBe(id);
    s.history(); expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
});
it('detaches on generic main or ancestor deletion but skips instances also being deleted', () => {
    const s = new Store(), frame = makeNode('frame', 0, 0), main = { ...makeNode('frame', 0, 0), parent: frame.id, component: true };
    const child = { ...makeNode('rect', 0, 0), parent: main.id }, instance = instanceNode(main, 200, 0);
    s.init([frame, main, child, instance]); s.commit([{ t: 'delete', id: frame.id }]);
    expect(s.doc.get(instance.id)?.instanceOf).toBeUndefined();
    s.history(); expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
    s.commit([{ t: 'delete', id: main.id }, { t: 'delete', id: instance.id }]);
    expect(s.doc.size).toBe(1);
    s.history(); expect(s.doc.get(instance.id)?.instanceOf).toBe(main.id);
});
it('undoes and redoes nested detach override path remapping in the same transaction', () => {
    const s = new Store(), main = { ...makeNode('frame', 0, 0), component: true }, child = { ...makeNode('rect', 0, 0), parent: main.id };
    const outer = { ...makeNode('frame', 0, 0), component: true }, nested = instanceNode(main, 0, 0, outer.id);
    const target = nested.id + '/' + child.id, parent = { ...instanceNode(outer, 200, 0), overrides: { [target]: { fill: '#123456' } } };
    s.init([main, child, outer, nested, parent]); s.commit(detachOps(s.doc, nested.id));
    expect(Object.keys(s.doc.get(parent.id)!.overrides!)).not.toContain(target);
    const remapped = s.doc.get(parent.id)!.overrides!, key = Object.keys(remapped)[0];
    s.commit([{ t: 'override', id: parent.id, target: key, key: 'fill', value: '#abcdef' }]);
    s.history(); expect(s.doc.get(parent.id)?.overrides).toEqual(remapped);
    expect(s.doc.get(parent.id)?.overrides).not.toBe(remapped);
    s.history(); expect(s.doc.get(parent.id)?.overrides).toEqual(parent.overrides);
    s.history(true); expect(Object.keys(s.doc.get(parent.id)!.overrides!)).not.toContain(target);
    s.history(true); expect(s.doc.get(parent.id)?.overrides?.[key].fill).toBe('#abcdef');
});
it('compares override map history by value without overwriting remote changes', () => {
    const s = new Store(), main = makeNode('frame', 0, 0), instance = instanceNode(main, 200, 0);
    s.init([main, instance]);
    s.set(instance.id, { overrides: { a: { fill: '#123456', opacity: .5 }, b: { radius: 2 } } });
    s.pending.clear();
    s.remote([{ t: 'set', id: instance.id, key: 'overrides', value: { b: { radius: 2 }, a: { opacity: .5, fill: '#123456' } } }]);
    s.history(); expect(s.doc.get(instance.id)?.overrides).toBeUndefined();
    s.history(true);
    s.pending.clear();
    const remote = { a: { fill: '#abcdef', opacity: .5 }, b: { radius: 2 } };
    s.remote([{ t: 'set', id: instance.id, key: 'overrides', value: remote }]);
    s.history(); expect(s.doc.get(instance.id)?.overrides).toEqual(remote);
});

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
