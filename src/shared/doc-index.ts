import type { Doc, Node } from './doc';

class DocIndex {
    revision = 0;
    treeRevision = 0;
    private parents = new Map<string | null, Set<string>>();
    private ordered = new Map<string | null, string[]>();
    constructor(private doc: Doc) {
        for (const [id, node] of doc) {
            if (!this.parents.has(node.parent)) this.parents.set(node.parent, new Set());
            this.parents.get(node.parent)!.add(id);
        }
    }
    set(id: string, node: Node) {
        const before = this.doc.get(id);
        if (!before || before.parent !== node.parent || before.index !== node.index) {
            if (before) { this.parents.get(before.parent)?.delete(id); this.ordered.delete(before.parent); }
            if (!this.parents.has(node.parent)) this.parents.set(node.parent, new Set());
            this.parents.get(node.parent)!.add(id);
            this.ordered.delete(node.parent);
        }
        if (!before || (['parent', 'index', 'name', 'type', 'hidden', 'locked', 'mask'] as const).some(key => before[key] !== node[key])) this.treeRevision++;
        this.revision++;
    }
    delete(id: string) {
        const before = this.doc.get(id);
        if (!before) return;
        this.parents.get(before.parent)?.delete(id);
        this.ordered.delete(before.parent);
        this.revision++; this.treeRevision++;
    }
    clear() {
        if (this.doc.size) { this.revision++; this.treeRevision++; }
        this.parents.clear(); this.ordered.clear();
    }
    children(parent: string | null): Node[] {
        let ids = this.ordered.get(parent);
        if (!ids) {
            ids = [...this.parents.get(parent) ?? []].sort((a, b) => {
                const ai = this.doc.get(a)!.index, bi = this.doc.get(b)!.index;
                return ai < bi ? -1 : ai > bi ? 1 : a.localeCompare(b);
            });
            this.ordered.set(parent, ids);
        }
        return ids.map(id => this.doc.get(id)!);
    }
}

const indexes = new WeakMap<Doc, DocIndex>();
export const docIndex = (doc: Doc) => indexes.get(doc);
export function indexDoc(doc: Doc = new Map()): Doc {
    if (indexes.has(doc)) return doc;
    const index = new DocIndex(doc);
    indexes.set(doc, index);
    const set = doc.set.bind(doc), remove = doc.delete.bind(doc), clear = doc.clear.bind(doc);
    Object.defineProperties(doc, {
        set: { value: (id: string, node: Node) => { index.set(id, node); return set(id, node); } },
        delete: { value: (id: string) => { index.delete(id); return remove(id); } },
        clear: { value: () => { index.clear(); clear(); } },
    });
    return doc;
}
