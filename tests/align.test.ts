import { describe, it, expect } from 'vitest';
import { align, eligible, type Alignment } from '../src/shared/align';
import { makeNode, type Node } from '../src/shared/doc';
import { world } from '../src/shared/geometry';
import { applyAlignment, alignmentKey } from '../src/client/align';
import { Store } from '../src/client/store';

const docOf = (...nodes: Node[]) => new Map(nodes.map(n => [n.id, n]));
describe('alignment', () => {
    it('aligns all six edges and centers to absolute selection bounds', () => {
        const a = { ...makeNode('rect', 10, 20), w: 20, h: 40 }, b = { ...makeNode('rect', 100, 200), w: 60, h: 80 }, doc = docOf(a, b);
        const expected: [Alignment, string, number, number][] = [['left', b.id, -90, 0], ['hcenter', a.id, 65, 0], ['right', a.id, 130, 0], ['top', b.id, 0, -180], ['vmiddle', a.id, 0, 110], ['bottom', a.id, 0, 220]];
        for (const [action, id, dx, dy] of expected) expect(align(doc, [a.id, b.id], action)).toContainEqual({ id, dx, dy });
    });
    it('aligns one child within a nested frame and rejects unsupported selections', () => {
        const f = makeNode('frame', 300, 200), p = { ...makeNode('frame', 20, 30), parent: f.id, w: 500 }, a = { ...makeNode('rect', 10, 20), parent: p.id }, doc = docOf(f, p, a);
        expect(align(doc, [a.id], 'right')).toEqual([{ id: a.id, dx: 390, dy: 0 }]);
        expect(align(doc, [], 'left')).toEqual([]);
        expect(align(doc, ['missing'], 'tidy')).toEqual([]);
        expect(align(doc, [f.id], 'left')).toEqual([]);
        expect(align(doc, [a.id], 'tidy')).toEqual([]);
        expect(align(doc, [a.id, f.id], 'horizontal')).toEqual([]);
    });
    it('skips hidden, locked, locked descendants and selected descendants', () => {
        const f = { ...makeNode('frame', 0, 0), locked: true }, a = { ...makeNode('rect', 0, 0), parent: f.id }, b = { ...makeNode('rect', 50, 0), hidden: true }, c = makeNode('frame', 200, 0), d = { ...makeNode('rect', 3, 4), parent: c.id };
        expect(eligible(docOf(f, a, b, c, d), [f.id, a.id, b.id, c.id, d.id, 'missing']).map(n => n.id)).toEqual([c.id]);
    });
    it('distributes unequal sizes with endpoints fixed on either axis', () => {
        const a = { ...makeNode('rect', 0, 0), w: 20, h: 20 }, b = { ...makeNode('rect', 30, 40), w: 40, h: 40 }, c = { ...makeNode('rect', 200, 200), w: 60, h: 60 }, doc = docOf(a, b, c);
        expect(align(doc, [c.id, a.id, b.id], 'horizontal')).toEqual([{ id: b.id, dx: 60, dy: 0 }]);
        expect(align(doc, [c.id, a.id, b.id], 'vertical')).toEqual([{ id: b.id, dx: 0, dy: 50 }]);
    });
    it('tidies rows, columns and a grid in position order with median nonnegative gaps', () => {
        const a = { ...makeNode('rect', 0, 0), w: 20, h: 20 }, b = { ...a, id: 'b', x: 40, y: 2 }, c = { ...a, id: 'c', x: 100, y: 1 };
        expect(align(docOf(a, b, c), [c.id, b.id, a.id], 'tidy')).toEqual([{ id: 'b', dx: 10, dy: -2 }, { id: 'c', dx: 0, dy: -1 }]);
        const col = [a, { ...b, x: 2, y: 40 }, { ...c, x: 1, y: 100 }];
        expect(align(docOf(...col), col.map(n => n.id), 'tidy')).toEqual([{ id: 'b', dx: -2, dy: 10 }, { id: 'c', dx: -1, dy: 0 }]);
        const grid = [a, b, { ...c, x: 2, y: 60 }, { ...a, id: 'd', x: 44, y: 62 }];
        expect(align(docOf(...grid), grid.map(n => n.id), 'tidy')).toContainEqual({ id: 'd', dx: -3, dy: -2 });
        const overlap = { ...b, x: 10, y: 0 };
        expect(align(docOf(a, overlap), [a.id, b.id], 'tidy')).toEqual([{ id: b.id, dx: 10, dy: 0 }]);
    });
    it('uses provided absolute bounding boxes and rounds deltas', () => {
        const a = makeNode('rect', 0, 0), b = makeNode('rect', 30, 0), doc = docOf(a, b);
        expect(align(doc, [a.id, b.id], 'left', (_, n) => ({ x: n === a ? -20.4 : 10.1, y: 0, w: 140, h: 140 }))).toEqual([{ id: b.id, dx: -30, dy: 0 }]);
    });
    it('moves frames with children in one synced, undoable transaction', () => {
        const store = new Store(), f = makeNode('frame', 200, 20), child = { ...makeNode('rect', 10, 10), parent: f.id }, a = makeNode('rect', 0, 0);
        store.doc = docOf(f, child, a); store.selection = new Set([f.id, child.id, a.id]);
        let sent = 0; store.send = ops => { sent += ops.length; };
        applyAlignment(store, 'left');
        expect(store.undoStack).toHaveLength(1); expect(sent).toBe(2);
        expect(world(store.doc, store.doc.get(child.id)!).x).toBe(10);
        store.history(); expect(store.doc.get(f.id)!.x).toBe(200);
        store.history(true); expect(store.doc.get(f.id)!.x).toBe(0);
        applyAlignment(store, 'left'); expect(store.undoStack).toHaveLength(1);
    });
    it('recognizes physical Alt shortcut codes, not platform-modified keys', () => {
        const store = new Store(); let prevented = false;
        const event = { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code: 'KeyA', key: 'å', preventDefault: () => { prevented = true; } } as KeyboardEvent;
        expect(alignmentKey(event, store)).toBe(true); expect(prevented).toBe(true);
        expect(alignmentKey({ ...event, code: 'KeyR' }, store)).toBe(false);
        expect(alignmentKey({ ...event, ctrlKey: true }, store)).toBe(false);
        expect(alignmentKey({ ...event, shiftKey: true, code: 'KeyH' }, store)).toBe(true);
        expect(alignmentKey({ ...event, ctrlKey: true, code: 'KeyT' }, store)).toBe(true);
    });
});
