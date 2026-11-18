import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { normalizeNode, type Node } from '../src/shared/doc';

export class StoredDocument extends Map<string, Node> {
    private dirty = new Set<string>();
    private layouts = new Set<string>();
    get needsLayout() { return this.layouts.size > 0; }
    override set(id: string, node: Node): this {
        super.set(id, node);
        this.dirty.add(id);
        if (node.type === 'frame' && (node.layout === 'horizontal' || node.layout === 'vertical')) this.layouts.add(id);
        else this.layouts.delete(id);
        return this;
    }
    override delete(id: string): boolean {
        this.dirty.add(id);
        this.layouts.delete(id);
        return super.delete(id);
    }
    async load(storage: DurableObjectStorage) {
        const legacy = await storage.get<Node[]>('nodes');
        const nodes = legacy ?? [...(await storage.list<Node>({ prefix: 'node:' })).values()];
        for (const n of nodes) this.set(n.id, normalizeNode(n));
        if (legacy) await this.persist(storage, {}, true);
        this.dirty.clear();
    }
    async persist(storage: DurableObjectStorage, extra: Record<string, unknown> = {}, migrate = false) {
        const ids = [...this.dirty];
        await storage.transaction(async txn => {
            const puts: Record<string, unknown> = { ...extra };
            const deletes: string[] = [];
            for (const id of ids) {
                const node = this.get(id);
                if (node) puts['node:' + id] = node;
                else deletes.push('node:' + id);
            }
            const entries = Object.entries(puts);
            for (let i = 0; i < entries.length; i += 128) await txn.put(Object.fromEntries(entries.slice(i, i + 128)));
            for (let i = 0; i < deletes.length; i += 128) await txn.delete(deletes.slice(i, i + 128));
            if (migrate) await txn.delete('nodes');
        });
        this.dirty.clear();
    }
}
