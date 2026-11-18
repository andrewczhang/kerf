import { between, children, descendants, type Doc, type Node } from '../../shared/doc';

export function duplicateNodes(doc: Doc, nodes: Node[], offset = 0): Map<string, Node> {
    const copies = new Map<string, Node>();
    const roots = nodes.filter(n => !nodes.some(a => a.id !== n.id && descendants(doc, a.id).some(c => c.id === n.id)));
    for (const n of roots)
        for (const c of [n, ...descendants(doc, n.id)])
            copies.set(c.id, { ...structuredClone(c), id: crypto.randomUUID() });
    for (const [id, n] of copies) {
        const original = doc.get(id)!;
        n.parent = copies.get(original.parent ?? '')?.id ?? original.parent;
        if (!copies.has(original.parent ?? '')) {
            n.x += offset;
            n.y += offset;
            const next = children(doc, original.parent).find(s => s.index > original.index);
            n.index = between(original.index, next?.index ?? null);
        }
    }
    return copies;
}
