import { expect, it } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { activatePresentationFrame, hotspotAt, presentationFrames } from '../src/client/ui/presentation';
import { topLevelFrames } from '../src/shared/pages';
import { Store } from '../src/client/store';
import { viewLink } from '../src/client/ui/sharing';

it('lists top-level frames on every page, excluding nested frames', () => {
    const a = { ...makeNode('page', 0, 0), id: 'a' }, b = { ...a, id: 'b' };
    const first = { ...makeNode('frame', 0, 0), parent: a.id }, second = { ...makeNode('frame', 0, 0), parent: b.id }, nested = { ...makeNode('frame', 0, 0), parent: first.id };
    const doc = new Map([a, b, first, second, nested].map(n => [n.id, n]));
    expect(presentationFrames(doc).map(n => n.id)).toEqual([first.id, second.id]);
    expect(topLevelFrames(doc).map(n => n.id)).toEqual([first.id, second.id]);
    expect(presentationFrames(new Map())).toEqual([]);
});
it('preserves page and frame in view links and activates cross-page prototype targets for viewers', () => {
    const a = { ...makeNode('page', 0, 0, 'A'), id: 'a' }, b = { ...a, id: 'b', index: 'B' };
    const first = { ...makeNode('frame', 0, 0), parent: a.id }, target = { ...makeNode('frame', 300, 0), parent: b.id };
    const link = { ...makeNode('rect', 0, 0), parent: first.id, link: target.id }, store = new Store(); store.enablePages(); store.init([a, b, first, target, link]);
    expect(hotspotAt(store.doc, first, { x: 20, y: 20 })).toBe(target.id);
    store.selection.add(first.id); const url = new URL(viewLink(store, 'key', 'https://example.com'));
    expect(url.pathname).toBe('/v/key'); expect(url.searchParams.get('page')).toBe(a.id); expect(url.searchParams.get('present')).toBe(first.id);
    store.readOnly = true; activatePresentationFrame(store, target.id); expect(store.currentPage).toBe(b.id); expect(store.pending.size).toBe(0);
    expect(activatePresentationFrame(store, 'missing')).toBeUndefined(); expect(store.currentPage).toBe(b.id);
    const blank = new URL(viewLink(store, 'key', 'https://example.com')); expect(blank.searchParams.get('page')).toBe(b.id); expect(blank.searchParams.has('present')).toBe(false);
});
