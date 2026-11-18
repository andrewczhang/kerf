import { expect, it } from 'vitest';
import { addAutoLayout, wrapInAutoLayout } from '../src/client/autolayout';
import { Store } from '../src/client/store';
import { makeNode, type Node } from '../src/shared/doc';
import { world } from '../src/shared/geometry';

function setup(nodes: Node[]) { const store = new Store(); store.send = () => {}; store.init(nodes); return store; }

it('guesses horizontal layout, average gap and edge padding, ordering by position', () => {
    const p = { ...makeNode('frame', 50, 60), w: 200, h: 100 };
    const a = { ...makeNode('rect', 10, 15, 'Z'), parent: p.id, w: 30, h: 40 };
    const b = { ...makeNode('rect', 70, 15, 'M'), parent: p.id, w: 30, h: 40 };
    const c = { ...makeNode('rect', 140, 15, 'A'), parent: p.id, w: 30, h: 40 };
    const s = setup([p, c, a, b]); addAutoLayout(s, p);
    expect(s.doc.get(p.id)).toMatchObject({ layout: 'horizontal', gap: 35, padLeft: 10, padRight: 30, padTop: 15, padBottom: 45, sizeW: 'hug', sizeH: 'hug' });
    expect(s.doc.get(a.id)!.index < s.doc.get(b.id)!.index && s.doc.get(b.id)!.index < s.doc.get(c.id)!.index).toBe(true);
    expect(s.undoStack).toHaveLength(1); s.history(); expect(s.doc.get(p.id)?.layout).toBeUndefined(); expect(s.doc.get(a.id)).toMatchObject({ x: 10, y: 15, index: 'Z' });
    s.history(true); expect(s.doc.get(p.id)?.layout).toBe('horizontal');
});

it('guesses vertical and rounds and clamps spacing and padding', () => {
    const p = makeNode('frame', 0, 0);
    const a = { ...makeNode('rect', -1, 10.4), w: 20, h: 30, parent: p.id };
    const b = { ...makeNode('rect', -1, 25), w: 20, h: 100, parent: p.id };
    const s = setup([p, b, a]); addAutoLayout(s, p);
    expect(s.doc.get(p.id)).toMatchObject({ layout: 'vertical', gap: 0, padLeft: 0, padTop: 10, padBottom: 0, padRight: 81 });
});

it('uses fixed empty defaults and ignores nonframes and already-auto frames', () => {
    const p = makeNode('frame', 0, 0), r = makeNode('rect', 0, 0); const s = setup([p, r]);
    addAutoLayout(s, r); expect(s.undoStack).toHaveLength(0);
    addAutoLayout(s, p); expect(s.doc.get(p.id)).toMatchObject({ layout: 'vertical', gap: 10, padLeft: 10, padTop: 10, padBottom: 10, padRight: 10, sizeW: 'fixed', sizeH: 'fixed', w: 100, h: 100 });
    addAutoLayout(s, s.doc.get(p.id)!); expect(s.undoStack).toHaveLength(1);
});

it('wraps siblings in their parent, preserving aligned world positions and undoing in one step', () => {
    const p = makeNode('frame', 100, 80);
    const a = { ...makeNode('rect', 10, 20, 'A'), parent: p.id, w: 20, h: 30 };
    const b = { ...makeNode('rect', 50, 20, 'B'), parent: p.id, w: 20, h: 30 };
    const s = setup([p, a, b]), before = [world(s.doc, a), world(s.doc, b)];
    const f = wrapInAutoLayout(s, [b, a])!;
    expect(f).toMatchObject({ parent: p.id, index: 'A', x: 10, y: 20, w: 60, h: 30, layout: 'horizontal', gap: 20 });
    expect([world(s.doc, s.doc.get(a.id)!), world(s.doc, s.doc.get(b.id)!)]).toEqual(before);
    expect([...s.selection]).toEqual([f.id]); expect(s.undoStack).toHaveLength(1);
    s.history(); expect(s.doc.has(f.id)).toBe(false); expect(s.doc.get(a.id)).toMatchObject({ parent: p.id, x: 10, y: 20 });
    s.history(true); expect(s.doc.get(a.id)?.parent).toBe(f.id);
});

it('handles empty input, ancestor selection, mixed parents and wrapping existing auto frames', () => {
    const p = { ...makeNode('frame', 100, 50), layout: 'vertical' as const };
    const a = { ...makeNode('rect', 0, 0), parent: p.id };
    const b = makeNode('rect', 250, 50); const s = setup([p, a, b]);
    expect(wrapInAutoLayout(s, [])).toBeUndefined(); expect(s.undoStack).toHaveLength(0);
    const f = wrapInAutoLayout(s, [p, a, b])!;
    expect(f.parent).toBeNull(); expect(s.doc.get(a.id)?.parent).toBe(p.id); expect(s.doc.get(p.id)?.parent).toBe(f.id);
});
