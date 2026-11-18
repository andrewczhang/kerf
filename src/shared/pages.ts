import { applyOp, between, children, makeNode, normalizeNode, type Doc, type Node, type Op } from './doc';
import { moveOps } from './layers';
import type { SizeOf } from './geometry';

export const defaultPage = 'page-1';
export const pages = (doc: Doc) => children(doc, null).filter(n => n.type === 'page');
export const topLevelFrames = (doc: Doc) => [...doc.values()].filter(n => n.type === 'frame' && (n.parent === null || doc.get(n.parent)?.type === 'page'));
export const pageRoots = (doc: Doc, page?: string) => children(doc, page && doc.has(page) ? page : null).filter(n => n.type !== 'page');
export function pageOf(doc: Doc, node: Node): string | undefined {
    const seen = new Set<string>(); let n: Node | undefined = node;
    while (n && !seen.has(n.id)) { if (n.type === 'page') return n.id; seen.add(n.id); n = n.parent ? doc.get(n.parent) : undefined; }
}
export function pageDocument(doc: Doc, page?: string): Doc {
    return page ? new Map([...doc].filter(([, n]) => pageOf(doc, n) === page)) : doc;
}
export function migrationOps(doc: Doc): Op[] {
    const first = pages(doc)[0], id = first?.id ?? defaultPage;
    const ops: Op[] = first ? [] : [{ t: 'create', node: { ...makeNode('page', 0, 0), id, name: 'Page 1' } }];
    return [...ops, ...children(doc, null).filter(n => n.type !== 'page').map(n => ({ t: 'set' as const, id: n.id, key: 'parent' as const, value: id }))];
}
export function previewDocument(snapshot: Doc, preferred?: string) {
    const doc: Doc = new Map([...snapshot].map(([id, node]) => [id, normalizeNode(node)]));
    for (const op of migrationOps(doc)) applyOp(doc, op);
    const list = pages(doc), page = list.find(n => n.id === preferred)?.id ?? list[0].id;
    return { doc, page };
}
export function addPage(doc: Doc): Node { return { ...makeNode('page', 0, 0, between(pages(doc).at(-1)?.index ?? null)), name: `Page ${pages(doc).length + 1}` }; }
export function deletePageOps(doc: Doc, id: string): Op[] { return doc.get(id)?.type === 'page' && pages(doc).length > 1 ? [{ t: 'delete', id }] : []; }
export function reorderPageOps(doc: Doc, id: string, target: string, after = false): Op[] {
    const node = doc.get(id), list = pages(doc).filter(n => n.id !== id), slot = list.findIndex(n => n.id === target);
    if (node?.type !== 'page' || slot < 0) return [];
    list.splice(slot + Number(after), 0, node); let index: string | null = null;
    return list.flatMap(n => { index = between(index); return n.index === index ? [] : [{ t: 'set' as const, id: n.id, key: 'index' as const, value: index }]; });
}
export function moveToPageOps(doc: Doc, id: string, page: string, sizeOf?: SizeOf): Op[] { return doc.get(id)?.type !== 'page' && doc.get(page)?.type === 'page' ? moveOps(doc, id, page, {}, sizeOf) : []; }
