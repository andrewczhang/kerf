import { children, type Doc, type Node } from '../../shared/doc';
import { contains, inverse, transform, type Point } from '../../shared/geometry';
import { hit, worldMatrix } from '../geometry';
import type { Store } from '../store';
import { pageDocument, pageOf, pages, topLevelFrames } from '../../shared/pages';

export function presentationSource(store: Store, preview: Doc | null, name: string) {
    return { fullDoc: preview ?? store.doc, doc: preview ? pages(preview).length ? pageDocument(preview, store.currentPage) : preview : store.pageDoc, selection: preview ? new Set<string>() : store.selection, note: preview ? 'Presenting saved version ' + name : '' };
}
export function activatePresentationFrame(store: Store, id: string) {
    const frame = presentationFrames(store.doc).find(n => n.id === id);
    if (!frame) return;
    const page = pageOf(store.doc, frame); if (page) store.setPage(page);
    return frame;
}
export function isPresentShortcut(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>) {
    return e.key.toLowerCase() === 'p' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey;
}
export function handlePresentShortcut(e: KeyboardEvent, launch: () => void) {
    if (!isPresentShortcut(e)) return false;
    e.preventDefault(); e.stopImmediatePropagation(); launch(); return true;
}
export function presentationFrames(doc: Doc) { return topLevelFrames(doc).filter(n => !n.hidden); }
export function interactiveHotspots(doc: Doc, frame: Node): Node[] {
    const targets = new Set(presentationFrames(doc).map(n => n.id)), result: Node[] = [];
    const visit = (n: Node) => {
        if (n.hidden) return;
        if (n.link && targets.has(n.link)) result.push(n);
        for (const child of children(doc, n.id)) visit(child);
    };
    visit(frame); return result;
}
export function presentationHit(doc: Doc, frame: Node, p: Point) {
    const unlocked = new Map([...doc].map(([id, n]) => [id, n.locked ? { ...n, locked: false } : n]));
    return hit(unlocked, p, undefined, frame.id) ?? frame;
}
export function hotspotAt(doc: Doc, frame: Node, p: Point) {
    if (frame.hidden || !presentationContains(doc, frame, p)) return;
    const links = new Map(interactiveHotspots(doc, frame).map(n => [n.id, n.link!]));
    let n: Node | undefined = presentationHit(doc, frame, p);
    while (n) { if (links.has(n.id)) return links.get(n.id); if (n.id === frame.id) break; n = n.parent ? doc.get(n.parent) : undefined; }
}
export function presentationContains(doc: Doc, frame: Node, p: Point) {
    return contains({ x: 0, y: 0, w: frame.w, h: frame.h }, transform(inverse(worldMatrix(doc, frame)), p));
}
