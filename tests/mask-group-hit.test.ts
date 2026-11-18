import { expect, it } from 'vitest';
import { makeNode, type Doc, type Node } from '../src/shared/doc';
import { hit, transform, worldMatrix } from '../src/shared/geometry';
import { outerGroup } from '../src/shared/layers';
import { Store } from '../src/client/store';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
const event = (timeStamp = 1000) => ({ timeStamp, shiftKey: false, altKey: false, buttons: 1 } as PointerEvent);
function scene() {
    const outer = { ...makeNode('group', 0, 0), w: 200, h: 200 };
    const inner = { ...makeNode('group', 0, 0), parent: outer.id, w: 200, h: 200 };
    const mask = { ...makeNode('ellipse', 50, 50, 'A'), parent: inner.id, mask: true };
    const content = { ...makeNode('rect', 0, 0, 'B'), parent: inner.id, w: 200, h: 200 };
    return { outer, inner, mask, content, doc: docOf(outer, inner, mask, content) };
}

it('does not fall back to nested group boxes when masked descendants miss', () => {
    const { outer, mask, content, doc } = scene();
    expect(hit(doc, { x: 20, y: 100 })).toBeUndefined();
    expect(hit(doc, { x: 51, y: 51 })).toBeUndefined();
    expect(hit(doc, { x: 100, y: 100 })?.id).toBe(content.id);
    expect(outerGroup(doc, hit(doc, { x: 100, y: 100 })!)?.id).toBe(outer.id);
    doc.delete(content.id);
    expect(hit(doc, { x: 100, y: 100 })?.id).toBe(mask.id);
    doc.delete(mask.id);
    expect(hit(doc, { x: 100, y: 100 })).toBeUndefined();
});

it('falls through to content behind a group and retains hidden-mask behavior', () => {
    const { outer, mask, content, doc } = scene();
    const behind = { ...makeNode('rect', 0, 0, 'A'), w: 200, h: 200 };
    doc.set(outer.id, { ...outer, index: 'B' }); doc.set(behind.id, behind);
    expect(hit(doc, { x: 20, y: 100 })?.id).toBe(behind.id);
    doc.set(mask.id, { ...mask, hidden: true });
    expect(hit(doc, { x: 20, y: 100 })?.id).toBe(content.id);
    doc.set(outer.id, { ...outer, index: 'B', locked: true });
    expect(hit(doc, { x: 100, y: 100 })?.id).toBe(behind.id);
});

it('uses rotated mask geometry rather than the group bounds under a rotated frame', () => {
    const { outer, mask, content, doc } = scene();
    const frame = { ...makeNode('frame', 300, 200), rotation: 30 };
    doc.set(frame.id, frame); doc.set(outer.id, { ...outer, parent: frame.id });
    const rotated = { ...mask, w: 100, h: 20, rotation: 90 }; doc.set(mask.id, rotated);
    const m = worldMatrix(doc, rotated);
    expect(hit(doc, transform(m, { x: 50, y: 10 }), frame.id)?.id).toBe(content.id);
    expect(hit(doc, transform(m, { x: 50, y: 40 }), frame.id)).toBeUndefined();
});

it('keeps clicks outside the mask deselected through pointer-up and selects inside', () => {
    const { doc, outer } = scene(), store = new Store(); store.init([...doc.values()]);
    const ctx = { store, viewport: new Viewport(() => {}), invalidate() {} }, tool = new Select(ctx);
    for (const p of [{ x: 20, y: 100 }, { x: 51, y: 51 }]) {
        store.selection.add(outer.id);
        tool.onPointerDown(p, event());
        expect([...store.selection]).toEqual([]);
        tool.onPointerUp(p);
        expect([...store.selection]).toEqual([]);
    }
    tool.onPointerDown({ x: 100, y: 100 }, event(2000));
    tool.onPointerUp({ x: 100, y: 100 });
    expect([...store.selection]).toEqual([outer.id]);
});

it('still selects groups with a dragged marquee and ignores sub-threshold movement', () => {
    const { doc, outer } = scene(), store = new Store(); store.init([...doc.values()]);
    const ctx = { store, viewport: new Viewport(() => {}), invalidate() {} }, tool = new Select(ctx);
    tool.onPointerDown({ x: 20, y: 100 }, event());
    tool.onPointerMove({ x: 21, y: 100 }, event());
    tool.onPointerUp({ x: 21, y: 100 });
    expect([...store.selection]).toEqual([]);
    tool.onPointerDown({ x: -20, y: -20 }, event(2000));
    tool.onPointerMove({ x: 220, y: 220 }, event(2001));
    tool.onPointerUp({ x: 220, y: 220 });
    expect([...store.selection]).toEqual([outer.id]);
});
