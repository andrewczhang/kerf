import { describe, it, expect } from 'vitest';
import { applyOp, makeNode, validNode, type Doc, type Node, type Op, type Key } from '../src/shared/doc';
import { componentOps, detachOps, expand, instanceNode, isVirtual, resizeFollowOps, splitVirtual } from '../src/shared/components';
import { blocked, moveOps } from '../src/shared/layers';
import { worldCorners } from '../src/shared/geometry';

function setup() {
    const main = { ...makeNode('frame', 10, 20), id: 'M', component: true };
    const child = { ...makeNode('rect', 5, 6), id: 'x', parent: main.id };
    const instance = { ...instanceNode(main, 200, 300), id: 'I' };
    const doc: Doc = new Map([main, child, instance].map(n => [n.id, n]));
    return { doc, main, child, instance };
}
function apply(doc: Doc, ops: Op[]) { for (const op of ops) applyOp(doc, op); }
describe('component model', () => {
    it('owns root rotation while inheriting and overriding descendant rotations', () => {
        const { doc, main, child, instance } = setup();
        apply(doc, [{ t: 'set', id: main.id, key: 'rotation', value: 60 }, { t: 'set', id: child.id, key: 'rotation', value: 15 }]);
        expect(instanceNode(doc.get(main.id)!, 0, 0).rotation).toBe(0);
        expect(expand(doc).get(instance.id)?.rotation).toBe(0);
        expect(expand(doc).get(instance.id + '/' + child.id)?.rotation).toBe(15);
        const before = doc.get(instance.id);
        apply(doc, [{ t: 'override', id: instance.id, target: '', key: 'rotation', value: 90 }]);
        expect(doc.get(instance.id)).toBe(before);
        expect(validNode({ ...instance, overrides: { '': { rotation: 90 } } })).toBe(false);
        apply(doc, [{ t: 'set', id: instance.id, key: 'rotation', value: 30 }, { t: 'override', id: instance.id, target: child.id, key: 'rotation', value: 45 }]);
        expect(expand(doc).get(instance.id)?.rotation).toBe(30);
        expect(expand(doc).get(instance.id + '/' + child.id)?.rotation).toBe(45);
        expect(validNode(doc.get(instance.id)!)).toBe(true);
        apply(doc, [{ t: 'override', id: instance.id, target: child.id, key: 'rotation', value: NaN }]);
        expect(expand(doc).get(instance.id + '/' + child.id)?.rotation).toBe(45);
        apply(doc, [{ t: 'override', id: instance.id, target: child.id, key: 'rotation', clear: true, value: undefined }]);
        expect(expand(doc).get(instance.id + '/' + child.id)?.rotation).toBe(15);
    });
    it('preserves instance world rotation when moving into a rotated frame and detaching', () => {
        const { doc, main, instance } = setup(), parent = { ...makeNode('frame', 500, 500), rotation: 20 };
        apply(doc, [{ t: 'create', node: parent }, { t: 'set', id: main.id, key: 'rotation', value: 60 }, { t: 'set', id: instance.id, key: 'rotation', value: 30 }]);
        const before = worldCorners(expand(doc), expand(doc).get(instance.id)!);
        apply(doc, moveOps(doc, instance.id, parent.id));
        expect(doc.get(instance.id)?.rotation).toBe(10);
        expect(expand(doc).get(instance.id)?.rotation).toBe(10);
        apply(doc, detachOps(doc, instance.id));
        expect(doc.get(instance.id)?.instanceOf).toBeUndefined(); expect(doc.get(instance.id)?.rotation).toBe(10);
        for (const [i, point] of worldCorners(doc, doc.get(instance.id)!).entries()) {
            expect(point.x).toBeCloseTo(before[i].x); expect(point.y).toBeCloseTo(before[i].y);
        }
    });
    it('expands groups and preserves instance visibility and locks independently of the main', () => {
        const { doc, main, instance } = setup(), group = { ...makeNode('group', 0, 0), parent: main.id };
        const child = { ...makeNode('rect', 10, 10), parent: group.id };
        apply(doc, [{ t: 'create', node: group }, { t: 'create', node: child }]);
        let resolved = expand(doc);
        expect(resolved.get(instance.id + '/' + child.id)?.parent).toBe(instance.id + '/' + group.id);
        apply(doc, [{ t: 'set', id: instance.id, key: 'hidden', value: true }, { t: 'set', id: instance.id, key: 'locked', value: true }]);
        resolved = expand(doc);
        expect(blocked(resolved, resolved.get(instance.id + '/' + child.id)!)).toBe(true);
        expect(doc.get(main.id)?.hidden).toBe(false);
        expect(moveOps(doc, child.id, instance.id)).toEqual([]);
        apply(doc, [{ t: 'set', id: instance.id, key: 'hidden', value: false }, { t: 'set', id: instance.id, key: 'locked', value: false }, { t: 'set', id: main.id, key: 'hidden', value: true }]);
        resolved = expand(doc);
        expect(blocked(resolved, resolved.get(instance.id + '/' + child.id)!)).toBe(false);
    });
    it('clamps fractional wrapping bounds to one unit without moving selected nodes', () => {
        const text = { ...makeNode('text', .8, .8), text: '' }, doc: Doc = new Map([[text.id, text]]);
        const { ops, id } = componentOps.create(doc, [text.id], () => ({ w: 1, h: 1 }));
        expect(ops).toHaveLength(4);
        apply(doc, ops);
        const frame = doc.get(id)!, child = doc.get(text.id)!;
        expect(validNode(frame)).toBe(true);
        expect(frame).toMatchObject({ x: .8, y: .8, w: 1, h: 1 });
        expect(child.parent).toBe(id);
        expect(frame.x + child.x).toBe(text.x);
        expect(frame.y + child.y).toBe(text.y);
    });
    it('emits no moves when the wrapping frame would be rejected', () => {
        const n = makeNode('rect', .8, .8), doc: Doc = new Map([[n.id, n]]);
        for (const size of [{ w: NaN, h: 1 }, { w: 1, h: NaN }, { w: Infinity, h: 1 }, { w: 1, h: Infinity }]) {
            const { ops } = componentOps.create(doc, [n.id], () => size);
            expect(ops).toEqual([]); apply(doc, ops);
            expect(doc.get(n.id)).toBe(n);
        }
        const orphan = { ...n, parent: 'missing' }; doc.set(n.id, orphan);
        expect(componentOps.create(doc, [n.id]).ops).toEqual([]);
        expect(doc.get(n.id)).toBe(orphan);
    });
    it('validates every embedded override and rejects invalid direct overrides', () => {
        const { doc, instance } = setup();
        for (const values of [{ strokeWidth: '2' }, { strokeWidth: Infinity }, { fill: 123 }, { stroke: {} }, { opacity: 2 }, { x: 10 }, { unknown: 1 }]) {
            expect(validNode({ ...instance, overrides: { x: values } } as unknown as Node)).toBe(false);
            for (const [key, value] of Object.entries(values)) applyOp(doc, { t: 'override', id: instance.id, target: 'x', key: key as Key, value });
        }
        expect(doc.get(instance.id)?.overrides).toBeUndefined();
        expect(validNode({ ...instance, overrides: { x: { fill: '#123456', strokeWidth: 2, stroke: null } } })).toBe(true);
        expect(validNode({ ...instance, overrides: {} })).toBe(true);
    });
    it('creates plain nodes quickly in large docs even with an unrelated corrupt cycle', () => {
        const doc: Doc = new Map();
        for (let i = 0; i < 2000; i++) {
            const n = { ...makeNode('rect', 0, 0), id: String(i) };
            doc.set(n.id, n);
        }
        const cycle = { ...makeNode('frame', 0, 0), id: 'cycle', instanceOf: 'cycle' };
        doc.set(cycle.id, cycle);
        const start = performance.now();
        for (let i = 0; i < 100; i++) applyOp(doc, { t: 'create', node: makeNode('rect', 0, 0) });
        expect(performance.now() - start).toBeLessThan(100);
        expect(doc.size).toBe(2101);
    });
    it('validates optional fields and sets only component', () => {
        const { doc, main } = setup();
        expect(validNode(main)).toBe(true);
        for (const values of [{ component: 'yes' }, { instanceOf: 1 }, { overrides: [] }, { overrides: null }])
            expect(validNode({ ...main, ...values } as unknown as Node)).toBe(false);
        applyOp(doc, { t: 'set', id: main.id, key: 'component', value: false });
        expect(doc.get(main.id)?.component).toBe(false);
        applyOp(doc, { t: 'set', id: main.id, key: 'instanceOf', value: 'I' });
        expect(doc.get(main.id)?.instanceOf).toBeUndefined();
    });
    it('does not let unrelated pre-existing cycles block creates or reparenting', () => {
        const { doc, main, child } = setup();
        doc.set('corrupt', { ...instanceNode(main, 0, 0), id: 'corrupt', instanceOf: 'corrupt' });
        const n = { ...instanceNode(main, 0, 0), id: 'safe' };
        applyOp(doc, { t: 'create', node: n });
        expect(doc.get(n.id)).toEqual(n);
        applyOp(doc, { t: 'set', id: child.id, key: 'parent', value: null });
        expect(doc.get(child.id)?.parent).toBeNull();
    });
    it('sets and clears overrides immutably and rejects structural keys and invalid values', () => {
        const { doc, instance, main } = setup();
        const op: Op = { t: 'override', id: instance.id, target: 'x', key: 'fill', value: '#123456' };
        applyOp(doc, op);
        expect(doc.get('I')?.overrides).toEqual({ x: { fill: '#123456' } });
        expect(instance.overrides).toBeUndefined();
        for (const key of ['id', 'type', 'parent', 'index', 'x', 'y', 'w', 'h', 'component', 'instanceOf', 'overrides'])
            applyOp(doc, { ...op, key: key as Key });
        applyOp(doc, { ...op, value: 'invalid' });
        expect(doc.get('I')?.overrides).toEqual({ x: { fill: '#123456' } });
        applyOp(doc, { ...op, id: main.id });
        expect(doc.get(main.id)?.overrides).toBeUndefined();
        applyOp(doc, { ...op, clear: true });
        expect(doc.get('I')?.overrides).toEqual({});
    });
    it('rejects children of instances on create and reparent', () => {
        const { doc, child } = setup();
        applyOp(doc, { t: 'create', node: { ...child, id: 'bad', parent: 'I' } });
        applyOp(doc, { t: 'set', id: child.id, key: 'parent', value: 'I' });
        expect(doc.has('bad')).toBe(false);
        expect(doc.get(child.id)?.parent).toBe('M');
    });
    it('rejects direct and indirect component cycles on create and reparent', () => {
        const { doc, main } = setup();
        const other = { ...main, id: 'N' };
        applyOp(doc, { t: 'create', node: other });
        applyOp(doc, { t: 'create', node: { ...instanceNode(main, 0, 0, 'N'), id: 'J' } });
        applyOp(doc, { t: 'create', node: { ...instanceNode(other, 0, 0, 'M'), id: 'bad' } });
        expect(doc.has('bad')).toBe(false);
        applyOp(doc, { t: 'set', id: 'I', key: 'parent', value: 'M' });
        applyOp(doc, { t: 'set', id: 'N', key: 'parent', value: 'M' });
        expect(doc.get('I')?.parent).toBeNull();
        expect(doc.get('N')?.parent).toBeNull();
    });
});
describe('expansion', () => {
    it('inherits live properties, preserves structure and applies root and descendant overrides', () => {
        const { doc, instance } = setup();
        apply(doc, [{ t: 'override', id: 'I', target: '', key: 'fill', value: '#112233' }, { t: 'override', id: 'I', target: 'x', key: 'opacity', value: 0.5 }]);
        let result = expand(doc);
        expect(result.get('I')).toMatchObject({ x: 200, y: 300, name: instance.name, fill: '#112233' });
        expect(result.get('I/x')).toMatchObject({ parent: 'I', x: 5, opacity: 0.5 });
        expect(doc.has('I/x')).toBe(false);
        apply(doc, [{ t: 'set', id: 'M', key: 'stroke', value: '#abcdef' }, { t: 'set', id: 'x', key: 'fill', value: '#654321' }]);
        result = expand(doc);
        expect(result.get('I')?.stroke).toBe('#abcdef');
        expect(result.get('I/x')?.fill).toBe('#654321');
    });
    it('uses flat descendant ids and nested instance paths with outer overrides winning', () => {
        const { doc, main, child } = setup();
        const nestedMain = { ...main, id: 'N' }, leaf = { ...child, id: 'z', parent: 'N' };
        const frame = { ...main, id: 'f', parent: 'M', component: false };
        const nested = { ...instanceNode(nestedMain, 1, 2, 'f'), id: 'J', overrides: { z: { fill: '#111111' } } };
        for (const n of [nestedMain, leaf, frame, nested]) doc.set(n.id, n);
        applyOp(doc, { t: 'override', id: 'I', target: 'J/z', key: 'fill', value: '#222222' });
        const result = expand(doc);
        expect(result.get('I/J')?.parent).toBe('I/f');
        expect(result.get('I/J/z')).toMatchObject({ parent: 'I/J', fill: '#222222' });
        expect(result.get('J/z')?.fill).toBe('#111111');
    });
    it('handles empty docs, missing mains and corrupt cycles with a depth cap', () => {
        expect(expand(new Map()).size).toBe(0);
        const { doc, instance } = setup();
        doc.delete('M');
        expect(expand(doc).get('I')).toEqual(instance);
        expect(expand(doc).has('I/x')).toBe(false);
        const { doc: cyclic, main } = setup();
        cyclic.set('J', { ...instanceNode(main, 0, 0, 'M'), id: 'J' });
        expect(expand(cyclic).size).toBeLessThan(20);
        for (let i = 0; i < 12; i++) {
            const m = { ...main, id: 'm' + i };
            cyclic.set(m.id, m);
            cyclic.set('j' + i, { ...instanceNode({ ...main, id: 'm' + (i + 1) }, 0, 0, m.id), id: 'j' + i });
        }
        expect(expand(cyclic).size).toBeLessThan(200);
    });
});
describe('component helpers', () => {
    it('remaps enclosing overrides when a nested instance is detached', () => {
        const { doc, main, child } = setup();
        const outer = { ...main, id: 'A' }, nested = { ...instanceNode(main, 0, 0, 'A'), id: 'J' };
        const parent = { ...instanceNode(outer, 0, 0), id: 'P', overrides: { 'J/x': { fill: '#123456' }, J: { opacity: 0.5 } } };
        const outerMain = { ...main, id: 'B' }, middle = { ...instanceNode(outer, 0, 0, 'B'), id: 'N' };
        const far = { ...instanceNode(outerMain, 0, 0), id: 'Q', overrides: { 'N/J/x': { fill: '#abcdef' } } };
        for (const n of [outer, nested, parent, outerMain, middle, far]) doc.set(n.id, n);
        apply(doc, detachOps(doc, nested.id));
        const baked = [...doc.values()].find(n => n.parent === 'J' && n.type === child.type)!;
        expect(doc.get('P')?.overrides).toEqual({ [baked.id]: { fill: '#123456' }, J: { opacity: 0.5 } });
        expect(expand(doc).get('P/' + baked.id)?.fill).toBe('#123456');
        expect(doc.get('Q')?.overrides).toEqual({ ['N/' + baked.id]: { fill: '#abcdef' } });
        expect(expand(doc).get('Q/N/' + baked.id)?.fill).toBe('#abcdef');
        expect(doc.get('J')?.instanceOf).toBeUndefined();
    });
    it('splits virtual paths', () => {
        expect(isVirtual('I/J/x')).toBe(true);
        expect(isVirtual('I')).toBe(false);
        expect(splitVirtual('I/J/x')).toEqual({ instance: 'I', target: 'J/x' });
        expect(splitVirtual('I')).toEqual({ instance: 'I', target: '' });
    });
    it('marks one frame or wraps siblings at their bounds', () => {
        const { doc } = setup();
        expect(componentOps.create(doc, ['M']).ops).toEqual([{ t: 'set', id: 'M', key: 'component', value: true }]);
        const b = { ...makeNode('rect', 40, 50), id: 'b', parent: 'M' };
        doc.set(b.id, b);
        const { ops, id } = componentOps.create(doc, ['x', 'b']);
        apply(doc, ops);
        expect(doc.get(id)).toMatchObject({ x: 5, y: 6, w: 135, h: 144, component: true, fill: '#ffffff', parent: 'M' });
        expect(doc.get('x')).toMatchObject({ parent: id, x: 0, y: 0 });
        expect(doc.get('b')).toMatchObject({ parent: id, x: 35, y: 44 });
        for (const ids of [[], ['missing'], ['I/x'], ['M', 'x']])
            expect(() => componentOps.create(doc, ids)).toThrow('Invalid component selection');
    });
    it('makes independent instances and detaches a resolved nested subtree', () => {
        const { doc, main } = setup();
        const instance = instanceNode(main, 22, 33, null, 'z');
        expect(instance).toMatchObject({ instanceOf: 'M', x: 22, y: 33, index: 'z', name: main.name });
        expect(instance.component).toBeUndefined();
        const other = { ...main, id: 'N' };
        doc.set('N', other);
        doc.set('J', { ...instanceNode(other, 1, 2, 'M'), id: 'J' });
        applyOp(doc, { t: 'override', id: 'I', target: '', key: 'fill', value: '#123456' });
        const ops = detachOps(doc, 'I');
        apply(doc, ops);
        expect(doc.get('I')).toMatchObject({ x: 200, y: 300, fill: '#123456' });
        expect(doc.get('I')?.instanceOf).toBeUndefined();
        const baked = [...doc.values()].filter(n => n.parent === 'I');
        expect(baked).toHaveLength(2);
        expect(baked.every(n => !isVirtual(n.id) && !n.instanceOf && !n.overrides)).toBe(true);
        expect(detachOps(doc, 'I')).toEqual([]);
        expect(detachOps(doc, 'missing')).toEqual([]);
    });
    it('follows only matching instance dimensions', () => {
        const { doc, main } = setup();
        doc.set('J', { ...instanceNode(main, 0, 0), id: 'J', w: 150 });
        expect(resizeFollowOps(doc, 'M', 'w', 100, 200)).toEqual([{ t: 'set', id: 'I', key: 'w', value: 200 }]);
        expect(resizeFollowOps(doc, 'M', 'h', 100, 200)).toHaveLength(2);
        expect(resizeFollowOps(doc, 'missing', 'w', 100, 200)).toEqual([]);
    });
});
