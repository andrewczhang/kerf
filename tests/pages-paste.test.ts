import { afterEach, expect, it, vi } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { Store } from '../src/client/store';
import { pasteLayers } from '../src/client/tools/select';
import { center, matrixAngle, worldMatrix } from '../src/shared/geometry';

afterEach(() => vi.unstubAllGlobals());
it('pastes roots into the current page instead of preserving an original parent on another page', async () => {
    const a = { ...makeNode('page', 0, 0, 'A'), id: 'a' }, b = { ...a, id: 'b', index: 'B' };
    const frame = { ...makeNode('frame', 0, 0), parent: a.id }, rect = { ...makeNode('rect', 20, 30), parent: frame.id };
    const clip = { nodes: [rect], roots: [rect.id], pastes: 0 };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(clip), setItem() {} });
    const store = new Store(); store.enablePages(b.id); store.init([a, b, frame, rect]);
    await pasteLayers(store, 'file');
    const copy = [...store.doc.values()].find(n => ![a.id, b.id, frame.id, rect.id].includes(n.id))!;
    expect(copy.parent).toBe(b.id); expect(store.pageDoc.has(copy.id)).toBe(true);
});
it('keeps a same-page target, preserves cross-page world geometry, and ignores an empty clipboard', async () => {
    const a = { ...makeNode('page', 0, 0, 'A'), id: 'a' }, b = { ...a, id: 'b', index: 'B' };
    const frame = { ...makeNode('frame', 200, 300), parent: a.id, rotation: 30 }, rect = { ...makeNode('rect', 20, 30), parent: frame.id, rotation: 15 };
    const store = new Store(); store.enablePages(); store.init([a, b, frame, rect]);
    let clip = { nodes: [rect], roots: [rect.id], pastes: 0, matrices: { [rect.id]: worldMatrix(store.doc, rect) } };
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(clip), setItem() {} });
    await pasteLayers(store, 'file'); expect(store.doc.get([...store.selection][0])?.parent).toBe(frame.id);
    store.setPage(b.id); const before = center(store.doc, rect), angle = matrixAngle(worldMatrix(store.doc, rect));
    await pasteLayers(store, 'file'); const copy = store.doc.get([...store.selection][0])!;
    expect(copy.parent).toBe(b.id); expect(center(store.doc, copy).x).toBeCloseTo(before.x + 20); expect(center(store.doc, copy).y).toBeCloseTo(before.y + 20);
    expect(matrixAngle(worldMatrix(store.doc, copy))).toBeCloseTo(angle);
    clip = { nodes: [], roots: [], pastes: 0, matrices: {} }; const count = store.doc.size;
    await pasteLayers(store, 'file'); expect(store.doc.size).toBe(count);
});
