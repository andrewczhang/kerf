import { expect, it } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { Store } from '../src/client/store';
import { presentationFrames, presentationSource } from '../src/client/ui/presentation';
import { pageDocument, previewDocument } from '../src/shared/pages';
import { hit } from '../src/shared/geometry';

it('falls back to the snapshot first page when the live page is absent', () => {
    const a = { ...makeNode('page', 0, 0), id: 'a' }, b = { ...a, id: 'b' }, frame = { ...makeNode('frame', 0, 0), parent: a.id };
    const store = new Store(); store.enablePages(b.id); store.init([a, b]);
    const source = presentationSource(store, new Map([a, frame].map(n => [n.id, n])), 'old');
    expect(presentationFrames(source.doc).map(n => n.id)).toEqual([frame.id]); expect(store.currentPage).toBe(b.id);
});
it('virtually migrates legacy and empty previews without changing the saved nodes or live store', () => {
    const frame = makeNode('frame', 50, 60), snapshot = new Map([[frame.id, frame]]), store = new Store(); store.enablePages(); store.init([]); store.pending.clear();
    const source = presentationSource(store, snapshot, 'legacy');
    expect(source.doc.get('page-1')?.type).toBe('page'); expect(source.doc.get(frame.id)?.parent).toBe('page-1');
    expect(snapshot.get(frame.id)?.parent).toBeNull(); expect(store.pending.size).toBe(0);
    const virtual = previewDocument(snapshot, 'missing'); expect(virtual.page).toBe('page-1');
    expect(hit(pageDocument(virtual.doc, virtual.page), { x: 60, y: 70 })?.id).toBe(frame.id);
    expect(presentationSource(store, new Map(), 'empty').doc.get('page-1')?.type).toBe('page');
});
it('honors an existing snapshot page and leaves other pages intact for preview navigation', () => {
    const a = { ...makeNode('page', 0, 0, 'A'), id: 'a' }, b = { ...a, id: 'b', index: 'B' };
    const snapshot = new Map([a, b].map(n => [n.id, n]));
    const preview = previewDocument(snapshot, b.id); expect(preview.page).toBe(b.id); expect(preview.doc.size).toBe(2); expect(snapshot.size).toBe(2);
});
