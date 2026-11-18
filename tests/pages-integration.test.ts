import { expect, it } from 'vitest';
import { makeNode, type Node } from '../src/shared/doc';
import { docIndex } from '../src/shared/doc-index';
import { hit } from '../src/shared/geometry';
import { pageDocument } from '../src/shared/pages';
import { Store } from '../src/client/store';
import { inViewport } from '../src/client/culling';
import { exportSVG } from '../src/client/export';
import { hotspotAt, presentationFrames, presentationSource } from '../src/client/ui/presentation';

const page = (id: string, index: string): Node => ({ ...makeNode('page', 0, 0, index), id });
it('keeps masks inside page scopes for hit testing and SVG, and never culls page containers', () => {
    const a = page('a', 'A'), b = page('b', 'B');
    const mask = { ...makeNode('rect', 0, 0, 'A'), id: 'mask', parent: a.id, mask: true };
    const rect = { ...makeNode('rect', 0, 0, 'B'), id: 'clipped', parent: a.id, w: 200, h: 200 };
    const other = { ...rect, id: 'other-page-only', parent: b.id };
    const doc = new Map([a, b, mask, rect, other].map(n => [n.id, n])), scoped = pageDocument(doc, a.id);
    expect(hit(scoped, { x: 50, y: 50 })?.id).toBe(rect.id);
    expect(hit(scoped, { x: 150, y: 150 })).toBeUndefined();
    const svg = exportSVG(scoped, scoped.keys()); expect(svg).toContain('<clipPath'); expect(svg).not.toContain(other.id);
    expect(inViewport(scoped, a, { x: 1000, y: 1000, w: 100, h: 100 }, 1)).toBe(true);
});
it('preserves read-only initialization for paged, legacy and empty documents without emitting migration ops', () => {
    const a = page('a', 'A'), rect = { ...makeNode('rect', 0, 0), parent: a.id };
    for (const nodes of [[a, rect], [{ ...rect, parent: null }], []]) {
        const store = new Store(); store.enablePages(); store.readOnly = true; store.init(nodes);
        expect([...store.doc.keys()]).toEqual(nodes.map(n => n.id)); expect(store.pending.size).toBe(0);
        expect(store.pageDoc.size).toBe(nodes.length); expect(store.undoStack).toEqual([]);
    }
});
it('keeps indexed page geometry fresh after remote edits and page switches', () => {
    const a = page('a', 'A'), b = page('b', 'B'), rect = { ...makeNode('rect', 0, 0), parent: a.id };
    const store = new Store(); store.enablePages(); store.init([a, b, rect]);
    expect(docIndex(store.pageDoc)).toBeDefined(); expect(hit(store.pageDoc, { x: 50, y: 50 })?.id).toBe(rect.id);
    store.remote([{ t: 'set', id: rect.id, key: 'x', value: 200 }]);
    expect(hit(store.pageDoc, { x: 50, y: 50 })).toBeUndefined(); expect(hit(store.pageDoc, { x: 250, y: 50 })?.id).toBe(rect.id);
    store.setPage(b.id); expect(store.pageDoc.has(rect.id)).toBe(false); expect(docIndex(store.pageDoc)).toBeDefined();
});
it('scopes presentation frames, links and saved previews to the current page while preserving legacy previews', () => {
    const a = page('a', 'A'), b = page('b', 'B');
    const frame = { ...makeNode('frame', 0, 0, 'A'), id: 'frame', parent: a.id }, target = { ...makeNode('frame', 300, 0, 'B'), id: 'target', parent: a.id };
    const other = { ...target, id: 'other', parent: b.id }, link = { ...makeNode('rect', 0, 0), parent: frame.id, link: target.id };
    const store = new Store(); store.enablePages(); store.init([a, b, frame, target, other, link]);
    expect(presentationFrames(presentationSource(store, null, '').doc).map(n => n.id)).toEqual([frame.id, target.id]);
    expect(hotspotAt(store.pageDoc, frame, { x: 20, y: 20 })).toBe(target.id);
    const preview = new Map(store.doc); store.setPage(b.id);
    expect(presentationFrames(presentationSource(store, preview, 'saved').doc).map(n => n.id)).toEqual([other.id]);
    const legacy = new Map([[frame.id, { ...frame, parent: null }]]);
    expect(presentationFrames(presentationSource(store, legacy, 'legacy').doc).map(n => n.id)).toEqual([frame.id]);
    expect(presentationFrames(new Map())).toEqual([]);
});
