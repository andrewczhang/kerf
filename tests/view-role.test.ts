import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../src/client/store';
import { makeNode } from '../src/shared/doc';
import { Sync } from '../src/client/sync';
import { loadAsset } from '../src/client/assets';

afterEach(() => vi.unstubAllGlobals());
it('blocks local document mutations and undo in a read-only store, but accepts remote edits', () => {
    const store = new Store(), node = makeNode('rect', 0, 0);
    store.init([node]); store.set(node.id, { x: 5 });
    const undo = [...store.undoStack]; store.pending.clear(); store.readOnly = true;
    store.set(node.id, { x: 20 }); store.commit([{ t: 'delete', id: node.id }]); store.history();
    expect(store.doc.get(node.id)?.x).toBe(5); expect(store.pending.size).toBe(0); expect(store.undoStack).toEqual(undo);
    store.remote([{ t: 'set', id: node.id, key: 'x', value: 30 }]); expect(store.doc.get(node.id)?.x).toBe(30);
    store.commit([]); expect(store.pending.size).toBe(0);
});
it('connects viewers using only the opaque key and initializes read-only before hello', () => {
    const socket = vi.fn(); vi.stubGlobal('WebSocket', class { constructor(url: string) { socket(url); } });
    vi.stubGlobal('location', { pathname: '/v/opaque-view-key', protocol: 'https:', host: 'example.com' });
    const store = new Store(), sync = new Sync(store, 'opaque-view-key');
    expect(sync.role).toBe('view'); expect(store.readOnly).toBe(true);
    expect(socket).toHaveBeenCalledWith('wss://example.com/v/opaque-view-key/ws');
});
it('loads viewer assets through the view alias and reports missing assets', async () => {
    vi.stubGlobal('location', { pathname: '/v/opaque-view-key' });
    const fetcher = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('createImageBitmap', vi.fn());
    await expect(loadAsset('opaque-view-key', 'missing')).rejects.toThrow('Asset unavailable');
    expect(fetcher).toHaveBeenCalledWith('/v/opaque-view-key/assets/missing');
});
