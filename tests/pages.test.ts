import { expect, it } from 'vitest';
import { applyOp, makeNode, normalizeNode, validNode, type Doc, type Node, type Op } from '../src/shared/doc';
import { addPage, defaultPage, deletePageOps, migrationOps, moveToPageOps, pageDocument, pageOf, pageRoots, pages, reorderPageOps } from '../src/shared/pages';
import { center, hit, matrixAngle, worldMatrix } from '../src/shared/geometry';
import { exportRoots } from '../src/client/export';
import { Store } from '../src/client/store';
import { targets } from '../src/client/snapping';
import type { Context } from '../src/client/tools/tool';
import { codeScopeIds, diffCode } from '../src/client/codesync';
import { toReact } from '../src/shared/codegen';
import { parseJSX } from '../src/shared/jsxparse';
import { commentOnPage, type Comment } from '../src/shared/comments';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, normalizeNode(n)]));
const apply = (doc: Doc, ops: Op[]) => { for (const op of ops) applyOp(doc, op); return doc; };
const page = (id = defaultPage, index = 'A'): Node => ({ ...makeNode('page', 0, 0, index), id });
const snapshot = (doc: Doc) => [...doc.values()].sort((a, b) => a.id.localeCompare(b.id));

it('migrates legacy and empty documents once without moving any content', () => {
    const frame = makeNode('frame', 200, 300), child = { ...makeNode('rect', 10, 20), parent: frame.id }, shape = makeNode('ellipse', -200, -400);
    const doc = docOf(frame, child, shape), before = center(doc, child);
    apply(doc, migrationOps(doc));
    expect(pages(doc)).toHaveLength(1); expect(doc.get(defaultPage)?.name).toBe('Page 1');
    expect(doc.get(frame.id)?.parent).toBe(defaultPage); expect(doc.get(shape.id)?.parent).toBe(defaultPage);
    expect(doc.get(child.id)?.parent).toBe(frame.id); expect(center(doc, doc.get(child.id)!)).toEqual(before);
    expect(migrationOps(doc)).toEqual([]);
    const empty = apply(new Map(), migrationOps(new Map())); expect([...empty.keys()]).toEqual([defaultPage]);
});
it('converges when two clients migrate concurrently, including duplicate page creation after rename', () => {
    const node = makeNode('rect', 20, 30), a = new Store(), b = new Store(); a.enablePages(); b.enablePages(); a.init([node]); b.init([node]);
    const ao = [...a.pending.values()].flat(), bo = [...b.pending.values()].flat(), server = docOf(node);
    apply(server, ao); apply(server, [{ t: 'set', id: defaultPage, key: 'name', value: 'Renamed' }]); apply(server, bo);
    expect(server.get(defaultPage)?.name).toBe('Renamed');
    a.remote(bo); b.remote(ao); expect(snapshot(a.doc)).toEqual(snapshot(b.doc)); expect(pages(a.doc)).toHaveLength(1);
    const reverse = apply(docOf(node), [...bo, ...ao]); expect(reverse.get(node.id)?.parent).toBe(defaultPage);
});
it('accepts geometry-free pages, rejects nested pages and prevents changing a page into a shape', () => {
    const minimal = { id: 'p', type: 'page', name: 'Page', index: 'A', parent: null } as Node;
    expect(validNode(minimal)).toBe(true); expect(validNode({ ...minimal, parent: 'other' })).toBe(false);
    const doc = apply(new Map(), [{ t: 'create', node: minimal }]);
    apply(doc, [{ t: 'set', id: 'p', key: 'parent', value: 'other' }, { t: 'set', id: 'p', key: 'type', value: 'rect' }, { t: 'set', id: 'p', key: 'rotation', value: 90 }]);
    expect(doc.get('p')).toMatchObject({ type: 'page', parent: null, rotation: 0 }); expect(worldMatrix(doc, doc.get('p')!)).toEqual([1, 0, 0, 1, 0, 0]);
});
it('filters actual render roots, hit testing and export roots to one page without clipping at page bounds', () => {
    const a = page(), b = page('b', 'B'), rect = { ...makeNode('rect', 400, 500), parent: a.id }, other = { ...makeNode('rect', 400, 500), parent: b.id };
    const doc = docOf(a, b, rect, other), scoped = pageDocument(doc, a.id);
    expect(pageRoots(scoped, a.id).map(n => n.id)).toEqual([rect.id]);
    expect(hit(scoped, { x: 450, y: 550 })?.id).toBe(rect.id); expect(hit(scoped, { x: 0, y: 0 })).toBeUndefined();
    expect(exportRoots(scoped, scoped.keys()).map(n => n.id)).toEqual([rect.id]);
    expect(pageRoots(pageDocument(doc, 'missing'), 'missing')).toEqual([]); expect(pageRoots(new Map())).toEqual([]);
    expect(pageOf(doc, rect)).toBe(a.id);
});
it('keeps one page, cascades page deletion and rejects invalid delete targets', () => {
    const a = page(), b = page('b', 'B'), frame = { ...makeNode('frame', 0, 0), parent: a.id }, rect = { ...makeNode('rect', 10, 20), parent: frame.id }, doc = docOf(a, b, frame, rect);
    expect(deletePageOps(doc, rect.id)).toEqual([]); expect(deletePageOps(doc, 'missing')).toEqual([]);
    apply(doc, deletePageOps(doc, a.id)); expect([...doc.keys()]).toEqual([b.id]); expect(deletePageOps(doc, b.id)).toEqual([]);
    apply(doc, [{ t: 'delete', id: b.id }]); expect(doc.has(b.id)).toBe(true);
});
it('moves a rotated node between pages preserving its world center and angle, and rejects invalid targets', () => {
    const a = page(), b = page('b', 'B'), frame = { ...makeNode('frame', 100, 200), parent: a.id, rotation: 30 }, rect = { ...makeNode('rect', 20, 40), parent: frame.id, rotation: 20 }, doc = docOf(a, b, frame, rect);
    const before = center(doc, rect), angle = matrixAngle(worldMatrix(doc, rect)); apply(doc, moveToPageOps(doc, rect.id, b.id));
    const moved = doc.get(rect.id)!; expect(moved.parent).toBe(b.id); expect(center(doc, moved).x).toBeCloseTo(before.x); expect(center(doc, moved).y).toBeCloseTo(before.y); expect(matrixAngle(worldMatrix(doc, moved))).toBeCloseTo(angle);
    expect(moveToPageOps(doc, a.id, b.id)).toEqual([]); expect(moveToPageOps(doc, rect.id, rect.id)).toEqual([]); expect(moveToPageOps(doc, 'missing', b.id)).toEqual([]);
});
it('adds and reorders pages with stable fractional indexes and ignores invalid reorder targets', () => {
    const doc = docOf(page(), page('b', 'B')), next = addPage(doc); expect(next.name).toBe('Page 3'); apply(doc, [{ t: 'create', node: next }]);
    apply(doc, reorderPageOps(doc, next.id, defaultPage)); expect(pages(doc).map(n => n.id)).toEqual([next.id, defaultPage, 'b']);
    apply(doc, reorderPageOps(doc, next.id, 'b', true)); expect(pages(doc).at(-1)?.id).toBe(next.id);
    expect(reorderPageOps(doc, 'missing', 'b')).toEqual([]); expect(reorderPageOps(doc, 'b', 'b')).toEqual([]);
});
it('keeps page choice local, honors a linked page, clears selection and attaches root tool creations', () => {
    const a = page(), b = page('b', 'B'), rect = { ...makeNode('rect', 0, 0), parent: a.id }, store = new Store(); store.enablePages(b.id); store.init([a, b, rect]);
    expect(store.currentPage).toBe(b.id); expect(store.pending.size).toBe(0);
    store.setPage(a.id); store.selection.add(rect.id); store.setPage(b.id); expect(store.selection.size).toBe(0); expect(store.pending.size).toBe(0);
    store.setPage('missing'); expect(store.currentPage).toBe(b.id);
    const created = makeNode('ellipse', 300, 400); store.commit([{ t: 'create', node: created }]); expect(store.doc.get(created.id)?.parent).toBe(b.id);
    store.remote(deletePageOps(store.doc, b.id)); expect(store.currentPage).toBe(a.id); expect(store.selection.size).toBe(0);
});
it('does not snap to geometry or page boxes on another page', () => {
    const a = page(), b = page('b', 'B'), rect = { ...makeNode('rect', 400, 500), parent: a.id }, other = { ...makeNode('rect', 800, 900), parent: b.id }, store = new Store(); store.enablePages(); store.init([a, b, rect, other]);
    expect(targets({ store } as Context)).toEqual([{ x: 400, y: 500, w: 100, h: 100 }]);
});
it('reconciles simultaneous optimistic deletions to the single server-kept page', () => {
    const nodes = [page(), page('b', 'B')], server = docOf(...nodes), a = new Store(), b = new Store();
    for (const store of [a, b]) { store.enablePages(); store.init(nodes); }
    const ao = deletePageOps(a.doc, nodes[0].id), bo = deletePageOps(b.doc, nodes[1].id); a.commit(ao); b.commit(bo);
    apply(server, ao); a.pending.clear(); for (const store of [a, b]) store.init([...server.values()]);
    apply(server, bo); b.pending.clear(); for (const store of [a, b]) store.init([...server.values()]);
    expect(pages(server).map(n => n.id)).toEqual(['b']); expect(snapshot(a.doc)).toEqual(snapshot(server)); expect(snapshot(b.doc)).toEqual(snapshot(server));
});
it('keeps page containers out of generated code and code edits inside the current page', () => {
    const a = page(), b = page('b', 'B'), rect = { ...makeNode('rect', 20, 30), parent: a.id }, other = { ...makeNode('rect', 60, 70), parent: b.id }, doc = docOf(a, b, rect, other), scoped = pageDocument(doc, a.id);
    expect([...codeScopeIds(scoped, null)]).toEqual([rect.id]); const jsx = toReact(scoped, null); expect(jsx).toContain(rect.id); expect(jsx).not.toContain(a.id);
    const tree = parseJSX(jsx); if ('error' in tree) throw Error(tree.error); expect(diffCode(scoped, null, tree)).toEqual([]);
});
it('scopes blank-canvas and legacy comments, and follows anchored comments across page moves', () => {
    const a = page(), b = page('b', 'B'), rect = { ...makeNode('rect', 20, 30), parent: a.id }, doc = docOf(a, b, rect);
    const c: Comment = { id: 'comment', thread: null, x: 10, y: 20, author: 'Alex', color: '#123456', text: 'Hello', at: 0 };
    expect(commentOnPage(doc, c, a.id)).toBe(true); expect(commentOnPage(doc, c, b.id)).toBe(false);
    expect(commentOnPage(doc, { ...c, page: b.id }, b.id)).toBe(true); expect(commentOnPage(new Map(), c, a.id)).toBe(false);
    const anchored = { ...c, page: a.id, node: rect.id }; expect(commentOnPage(doc, anchored, a.id)).toBe(true);
    apply(doc, moveToPageOps(doc, rect.id, b.id)); expect(commentOnPage(doc, anchored, a.id)).toBe(false); expect(commentOnPage(doc, anchored, b.id)).toBe(true);
});
