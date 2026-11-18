import { afterEach, expect, it, vi } from 'vitest';
import { docIndex, indexDoc } from '../src/shared/doc-index';
import { applyOp, children, descendants, makeNode } from '../src/shared/doc';
import { world } from '../src/client/geometry';
import { clearTextLayouts, measureTextNode, textPaintBounds } from '../src/client/text-layout';
import { Store } from '../src/client/store';

afterEach(() => { clearTextLayouts(); vi.unstubAllGlobals(); });

it('indexes an existing Map without mutating its contents or changing its identity and remains idempotent', () => {
    const node = makeNode('rect', 0, 0), doc = new Map([[node.id, node]]);
    const set = vi.spyOn(doc, 'set'), clear = vi.spyOn(doc, 'clear');
    expect(indexDoc(doc)).toBe(doc); expect(indexDoc(doc)).toBe(doc);
    expect(set).not.toHaveBeenCalled(); expect(clear).not.toHaveBeenCalled();
    expect(doc).toEqual(new Map([[node.id, node]])); expect(children(doc, null)).toEqual([node]);
});

it('indexes sorted children without exposing cached order and follows replacement, reparent, deletion and clear', () => {
    const frame = makeNode('frame', 0, 0), a = { ...makeNode('rect', 0, 0, 'B'), parent: frame.id }, b = { ...makeNode('rect', 0, 0, 'A'), parent: frame.id };
    const doc = indexDoc(new Map([frame, a, b].map(n => [n.id, n]))), index = docIndex(doc)!;
    expect(children(doc, frame.id)).toEqual([b, a]);
    children(doc, frame.id).reverse(); expect(children(doc, frame.id)).toEqual([b, a]);
    const revision = index.treeRevision;
    applyOp(doc, { t: 'set', id: a.id, key: 'x', value: 20 });
    expect(index.treeRevision).toBe(revision); expect(children(doc, frame.id)[1].x).toBe(20);
    applyOp(doc, { t: 'set', id: a.id, key: 'index', value: '0' });
    expect(children(doc, frame.id).map(n => n.id)).toEqual([a.id, b.id]);
    applyOp(doc, { t: 'set', id: a.id, key: 'parent', value: null });
    expect(descendants(doc, frame.id)).toEqual([b]);
    const before = index.revision;
    applyOp(doc, { t: 'set', id: frame.id, key: 'parent', value: frame.id });
    expect(index.revision).toBe(before);
    applyOp(doc, { t: 'delete', id: frame.id });
    expect(children(doc, frame.id)).toEqual([]); expect([...doc.keys()]).toEqual([a.id]);
    doc.clear(); expect(children(doc, null)).toEqual([]); expect(doc.delete('missing')).toBe(false);
});

it.each(['name', 'type', 'hidden', 'locked'] as const)('invalidates the layer tree for %s but not geometry or rejected edits', key => {
    const node = makeNode('rect', 0, 0), doc = indexDoc(new Map([[node.id, node]])), index = docIndex(doc)!, revision = index.treeRevision;
    const value = { name: 'New', type: 'ellipse', hidden: true, locked: true }[key];
    applyOp(doc, { t: 'set', id: node.id, key, value });
    expect(index.treeRevision).toBeGreaterThan(revision);
    const next = index.treeRevision;
    applyOp(doc, { t: 'set', id: node.id, key: 'w', value: -1 });
    expect(index.treeRevision).toBe(next);
});

it('caches world bounds until a parent changes, including replacement maps and hypothetical nodes', () => {
    const p = makeNode('frame', 20, 30), n = { ...makeNode('rect', 5, 7), parent: p.id };
    const doc = indexDoc(new Map([p, n].map(n => [n.id, n])));
    const first = world(doc, n); expect(world(doc, n)).toBe(first);
    applyOp(doc, { t: 'set', id: p.id, key: 'x', value: 100 });
    expect(world(doc, n)).toMatchObject({ x: 105, y: 37 }); expect(world(doc, n)).not.toBe(first);
    expect(world(doc, { ...n, x: 50 }).x).toBe(150);
    expect(world(indexDoc(new Map([[n.id, n]])), n).x).toBe(5);
    expect(world(indexDoc(), n).x).toBe(5);
});

it('reuses text layout across geometry/style clones, invalidates text properties and font loads, and caches ink', () => {
    const measureText = vi.fn((s: string) => ({ width: s.length * 10 }));
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText }) }) });
    const node = { ...makeNode('text', 0, 0), text: 'abcd', textWidth: 'fixed' as const, w: 40 };
    const first = measureTextNode(node), calls = measureText.mock.calls.length;
    expect(measureTextNode({ ...node, x: 99, fill: '#ffffff' })).toBe(first);
    expect(measureText.mock.calls.length).toBe(calls);
    const ink = textPaintBounds(node), inkCalls = measureText.mock.calls.length;
    expect(textPaintBounds({ ...node, y: 50 })).toBe(ink); expect(measureText.mock.calls.length).toBe(inkCalls);
    for (const change of [{ text: '' }, { w: 20 }, { fontSize: 30 }, { fontFamily: 'serif' as const }, { fontWeight: 700 as const }, { textAlign: 'right' as const }, { textWidth: 'auto' as const }]) {
        expect(measureTextNode({ ...node, ...change })).not.toBe(first);
    }
    expect(measureTextNode({ ...node, text: '' }).lines).toEqual(['']);
    clearTextLayouts(); expect(measureTextNode(node)).not.toBe(first);
});

it('skips layout and full geometry snapshots for isolated moves locally, remotely and in history', () => {
    const measure = vi.fn(() => ({ w: 20, h: 24 })), store = new Store(measure);
    const root = makeNode('rect', 0, 0), frame = { ...makeNode('frame', 100, 100), layout: 'vertical' as const }, text = { ...makeNode('text', 0, 0), parent: frame.id };
    store.init([root, frame, text]); measure.mockClear();
    const untouched = store.doc.get(text.id);
    store.begin(); store.set(root.id, { x: 30, y: 40 }); store.set(root.id, { x: 50 }); store.end();
    expect(measure).not.toHaveBeenCalled(); expect(store.doc.get(text.id)).toBe(untouched);
    store.history(); expect(store.doc.get(root.id)).toMatchObject({ x: 0, y: 0 });
    store.history(true); expect(store.doc.get(root.id)).toMatchObject({ x: 50, y: 40 });
    store.pending.clear(); store.remote([{ t: 'set', id: root.id, key: 'x', value: 99 }]);
    store.remote([]); expect(measure).not.toHaveBeenCalled();
    store.set(frame.id, { gap: 12 }); expect(measure).toHaveBeenCalled();
    measure.mockClear(); store.set(text.id, { y: 80 }); expect(measure).toHaveBeenCalled(); expect(store.doc.get(text.id)?.y).toBe(0);
});
