import { describe, expect, it, vi } from 'vitest';
import { makeNode, type Doc, type Node } from '../src/shared/doc';
import { Store } from '../src/client/store';
import { handlePresentShortcut, hotspotAt, interactiveHotspots, presentationFrames, presentationSource } from '../src/client/ui/presentation';
import { commentAnchor, commentPoint } from '../src/client/ui/comments';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
function scene() {
    const frame = { ...makeNode('frame', 100, 200), id: 'frame', w: 400, h: 400 };
    const target = { ...makeNode('frame', 700, 200), id: 'target' };
    const link = { ...makeNode('rect', 10, 20), id: 'link', parent: frame.id, w: 50, h: 50, link: target.id };
    return { frame, target, link, doc: docOf(frame, target, link) };
}
describe('presentation hotspots', () => {
    it('reveals and follows visible valid links, including locked layers', () => {
        const { frame, target, link, doc } = scene(); link.locked = true;
        expect(interactiveHotspots(doc, frame)).toEqual([link]);
        expect(hotspotAt(doc, frame, { x: 120, y: 230 })).toBe(target.id);
        expect(hotspotAt(doc, frame, { x: 0, y: 0 })).toBeUndefined();
    });
    it('does not reveal or follow hidden nodes, hidden ancestors, or missing targets', () => {
        const { frame, target, link, doc } = scene();
        link.hidden = true;
        expect(interactiveHotspots(doc, frame)).toEqual([]); expect(hotspotAt(doc, frame, { x: 120, y: 230 })).toBeUndefined();
        link.hidden = false;
        const group = { ...makeNode('group', 0, 0), id: 'group', parent: frame.id, w: 200, h: 200, hidden: true };
        doc.set(group.id, group); link.parent = group.id;
        expect(interactiveHotspots(doc, frame)).toEqual([]); expect(hotspotAt(doc, frame, { x: 120, y: 230 })).toBeUndefined();
        group.hidden = false; doc.delete(target.id);
        expect(interactiveHotspots(doc, frame)).toEqual([]); expect(hotspotAt(doc, frame, { x: 120, y: 230 })).toBeUndefined();
    });
    it('filters non-frame, nested and hidden targets, and handles empty frames', () => {
        const { frame, target, link, doc } = scene();
        target.hidden = true; expect(interactiveHotspots(doc, frame)).toEqual([]);
        target.hidden = false; target.parent = frame.id; expect(interactiveHotspots(doc, frame)).toEqual([]);
        target.parent = null; target.type = 'rect'; expect(interactiveHotspots(doc, frame)).toEqual([]);
        expect(presentationFrames(new Map())).toEqual([]);
        expect(interactiveHotspots(docOf(frame), frame)).toEqual([]);
        expect(hotspotAt(docOf(frame), frame, { x: 120, y: 230 })).toBeUndefined();
        frame.hidden = true; link.link = frame.id;
        expect(interactiveHotspots(doc, frame)).toEqual([]);
    });
    it('falls back to a valid ancestor hotspot rather than a dangling child link', () => {
        const { frame, target, link, doc } = scene(); frame.link = target.id; link.link = 'deleted';
        expect(interactiveHotspots(doc, frame)).toEqual([frame]);
        expect(hotspotAt(doc, frame, { x: 120, y: 230 })).toBe(target.id);
    });
});
describe('presentation source', () => {
    it('uses the saved snapshot and clears live selection while previewing', () => {
        const store = new Store(), { frame, doc } = scene(); store.init([{ ...frame, name: 'Live frame', w: 999 }]); store.selection.add(frame.id);
        const source = presentationSource(store, doc, 'Milestone');
        expect(source.doc).toBe(doc); expect(source.doc.get(frame.id)?.w).toBe(400); expect(source.selection.size).toBe(0);
        expect(source.note).toBe('Presenting saved version Milestone');
        store.set(frame.id, { w: 123 }); expect(source.doc.get(frame.id)?.w).toBe(400);
    });
    it('uses even an empty preview rather than falling back to live, and uses live state otherwise', () => {
        const store = new Store(), { frame } = scene(); store.init([frame]); store.selection.add(frame.id);
        expect(presentationSource(store, new Map(), 'Empty').doc.size).toBe(0);
        const source = presentationSource(store, null, '');
        expect(source.doc).toBe(store.doc); expect(source.selection).toBe(store.selection); expect(source.note).toBe('');
    });
});
describe('Present shortcut', () => {
    function key(shiftKey: boolean, extra = {}) {
        return Object.assign(new Event('keydown', { cancelable: true }), { key: shiftKey ? 'P' : 'p', shiftKey, ctrlKey: false, metaKey: false, altKey: false, ...extra }) as KeyboardEvent;
    }
    it('leaves P for Pen and stops Shift+P before tool switching', () => {
        const events = new EventTarget(), launch = vi.fn(); let active = 'select';
        events.addEventListener('keydown', e => { handlePresentShortcut(e as KeyboardEvent, launch); });
        events.addEventListener('keydown', e => { if ((e as KeyboardEvent).key.toLowerCase() === 'p') active = 'pen'; });
        events.dispatchEvent(key(false)); expect(active).toBe('pen'); expect(launch).not.toHaveBeenCalled();
        active = 'hand'; const shifted = key(true); events.dispatchEvent(shifted);
        expect(active).toBe('hand'); expect(launch).toHaveBeenCalledOnce(); expect(shifted.defaultPrevented).toBe(true);
    });
    it('ignores modified and unrelated shortcuts', () => {
        const launch = vi.fn();
        for (const e of [key(true, { ctrlKey: true }), key(true, { metaKey: true }), key(true, { altKey: true }), key(true, { key: 'C' })]) expect(handlePresentShortcut(e, launch)).toBe(false);
        expect(launch).not.toHaveBeenCalled();
    });
});
describe('shared comment coordinates', () => {
    it('round trips a Present draft through node-relative coordinates for canvas pins', () => {
        const { frame, link, doc } = scene(), point = { x: 120, y: 230 };
        const anchor = commentAnchor(doc, point, link);
        expect(anchor).toEqual({ node: link.id, x: 10, y: 10 }); expect(commentPoint(doc, anchor)).toEqual(point);
        expect(commentPoint(doc, commentAnchor(doc, point, frame))).toEqual(point);
        link.x += 50; expect(commentPoint(doc, anchor)).toEqual({ x: 170, y: 230 });
    });
    it('supports unanchored canvas comments and a removed anchor', () => {
        const point = { x: 20, y: 30 };
        expect(commentAnchor(new Map(), point)).toEqual(point);
        expect(commentPoint(new Map(), { ...point, node: 'removed' })).toEqual(point);
    });
});
