import { expect, it, vi } from 'vitest';
import type { DurableObjectStorage } from '@cloudflare/workers-types';
import { StoredDocument } from '../worker/document';
import { applyOp, makeNode } from '../src/shared/doc';
import { applyLayout } from '../src/shared/layout';
import { Features } from '../worker/features';

function storage() {
    const data = new Map<string, unknown>();
    const api = {
        get: vi.fn(async (key: string) => structuredClone(data.get(key))),
        list: vi.fn(async ({ prefix }: { prefix: string }) => new Map([...data].filter(([key]) => key.startsWith(prefix)))),
        put: vi.fn(async (key: string | Record<string, unknown>, value?: unknown) => {
            const entries: [string, unknown][] = typeof key === 'string' ? [[key, value]] : Object.entries(key);
            for (const [k, v] of entries) data.set(k, structuredClone(v));
        }),
        delete: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) data.delete(key); }),
        transaction: vi.fn(async (fn: (txn: unknown) => Promise<unknown>) => {
            const before = new Map(data);
            try { return await fn(api); } catch (error) { data.clear(); for (const [k, v] of before) data.set(k, v); throw error; }
        }),
    };
    return { data, api, store: api as unknown as DurableObjectStorage };
}

it('migrates a large legacy snapshot atomically, normalizes and reloads node keys', async () => {
    const { data, api, store } = storage(), doc = new StoredDocument();
    const nodes = Array.from({ length: 260 }, () => makeNode('rect', 0, 0));
    data.set('nodes', nodes); data.set('receipt:client', 7);
    await doc.load(store);
    expect(data.has('nodes')).toBe(false);
    expect(data.get('receipt:client')).toBe(7);
    expect(api.put).toHaveBeenCalledTimes(3);
    const loaded = new StoredDocument(); await loaded.load(store);
    expect(loaded).toEqual(doc);
    expect(loaded.get(nodes[0].id)).toMatchObject({ hidden: false, locked: false });
    api.put.mockClear();
    await loaded.persist(store);
    expect(api.put).not.toHaveBeenCalled();
});

it('loads empty storage and keeps failed migrations retryable', async () => {
    const { data, api, store } = storage();
    const empty = new StoredDocument(); await empty.load(store); expect(empty.size).toBe(0);
    const n = makeNode('rect', 0, 0); data.set('nodes', [n]);
    api.delete.mockRejectedValueOnce(Error('disk failure'));
    await expect(new StoredDocument().load(store)).rejects.toThrow('disk failure');
    expect(data.get('nodes')).toEqual([n]); expect(data.has('node:' + n.id)).toBe(false);
    const doc = new StoredDocument(); await doc.load(store); expect(doc.get(n.id)).toEqual(n);
});

it('writes only changed nodes with receipts, including layout changes and cascading deletes', async () => {
    const { data, api, store } = storage(), doc = new StoredDocument();
    const frame = { ...makeNode('frame', 0, 0), layout: 'horizontal' as const };
    const child = { ...makeNode('rect', 90, 20), parent: frame.id }, other = makeNode('rect', 0, 0);
    for (const node of [frame, child, other]) applyOp(doc, { t: 'create', node });
    applyLayout(doc); await doc.persist(store);
    api.put.mockClear();
    applyOp(doc, { t: 'set', id: frame.id, key: 'padLeft', value: 20 });
    applyLayout(doc); await doc.persist(store, { 'receipt:client': 2 });
    expect(Object.keys(api.put.mock.calls[0][0])).toEqual(expect.arrayContaining(['node:' + frame.id, 'node:' + child.id, 'receipt:client']));
    expect(Object.keys(api.put.mock.calls[0][0])).toHaveLength(3);
    expect(data.get('node:' + child.id)).toMatchObject({ x: 20 });
    api.put.mockClear();
    applyOp(doc, { t: 'set', id: other.id, key: 'w', value: -1 });
    await doc.persist(store, { 'receipt:client': 3 });
    expect(api.put.mock.calls[0][0]).toEqual({ 'receipt:client': 3 });
    applyOp(doc, { t: 'delete', id: frame.id }); await doc.persist(store, { 'receipt:client': 4 });
    expect(data.has('node:' + frame.id)).toBe(false); expect(data.has('node:' + child.id)).toBe(false);
    expect(doc.needsLayout).toBe(false);
    const loaded = new StoredDocument(); await loaded.load(store); expect([...loaded.keys()]).toEqual([other.id]);
});

it('restores versions into node storage without resurrecting deleted nodes on reload', async () => {
    const { store } = storage(), doc = new StoredDocument();
    const original = makeNode('rect', 1, 2), added = makeNode('rect', 3, 4);
    doc.set(original.id, original); await doc.persist(store);
    const features = new Features(store, doc, () => {});
    await features.save('Checkpoint', 'Sam', false);
    applyOp(doc, { t: 'delete', id: original.id }); doc.set(added.id, added); await doc.persist(store);
    await features.message({ type: 'version-restore', id: features.versions[0].id }, { name: 'Sam' } as never, () => {});
    const loaded = new StoredDocument(); await loaded.load(store);
    expect([...loaded.values()]).toEqual([original]);
});

it('persists shared style updates and detachments without recreating a stale legacy snapshot', async () => {
    const { data, store } = storage(), doc = new StoredDocument();
    const node = { ...makeNode('rect', 0, 0), fillStyle: 'accent' };
    doc.set(node.id, node); await doc.persist(store);
    const features = new Features(store, doc, () => {}), peer = { name: 'Sam' } as never;
    await features.message({ type: 'style-upsert', style: { id: 'accent', kind: 'color', name: 'Accent', color: '#123456' } }, peer, () => {});
    expect(data.has('nodes')).toBe(false);
    applyOp(doc, { t: 'set', id: node.id, key: 'x', value: 50 }); await doc.persist(store);
    const loaded = new StoredDocument(); await loaded.load(store);
    const next = new Features(store, loaded, () => {}); await next.load();
    expect(loaded.get(node.id)).toMatchObject({ x: 50, fill: '#123456', fillStyle: 'accent' });
    expect(next.styles).toHaveLength(1);
    await next.message({ type: 'style-delete', id: 'accent' }, peer, () => {});
    const detached = new StoredDocument(); await detached.load(store);
    expect(detached.get(node.id)).toMatchObject({ x: 50, fill: '#123456', fillStyle: null });
    expect(data.has('nodes')).toBe(false);
});
