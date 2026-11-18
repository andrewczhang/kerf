import { afterEach, expect, it, vi } from 'vitest';
import { Store } from '../src/client/store';
import { makeNode } from '../src/shared/doc';
import { Sync } from '../src/client/sync';
import { loadAsset } from '../src/client/assets';
import { isViewerCanvasShortcut } from '../src/client/shortcuts';

it('leaves focus navigation and control activation to the browser while excluding editor shortcuts', () => {
    const event = (key: string) => ({ key, ctrlKey: false, metaKey: false, altKey: false });
    for (const key of ['Tab', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'r', 't', 'p'])
        expect(isViewerCanvasShortcut(event(key), false)).toBe(false);
    for (const key of ['Enter', ' ', 'Tab']) expect(isViewerCanvasShortcut(event(key), true)).toBe(false);
    for (const key of ['v', 'h', 'c', 'Escape', ' ']) expect(isViewerCanvasShortcut(event(key), false)).toBe(true);
    expect(isViewerCanvasShortcut({ ...event('v'), ctrlKey: true }, false)).toBe(false);
    expect(isViewerCanvasShortcut({ ...event('h'), metaKey: true }, false)).toBe(false);
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
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
    vi.useFakeTimers();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', { onLine: true, locks: { request: (_name: string, _options: unknown, callback: (lock: object) => unknown) => Promise.resolve(callback({})) } });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem() {} });
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
    const socket = vi.fn(); vi.stubGlobal('WebSocket', class { constructor(url: string) { socket(url); } });
    vi.stubGlobal('location', { pathname: '/v/opaque-view-key', protocol: 'https:', host: 'example.com' });
    const store = new Store(), sync = new Sync(store, 'opaque-view-key');
    expect(sync.role).toBe('view'); expect(store.readOnly).toBe(true);
    expect(socket).toHaveBeenCalledWith('wss://example.com/v/opaque-view-key/ws?clientId=' + encodeURIComponent(sync.clientId));
});
it('loads viewer assets through the view alias and reports missing assets', async () => {
    vi.stubGlobal('location', { pathname: '/v/opaque-view-key' });
    const fetcher = vi.fn().mockResolvedValue({ ok: false }); vi.stubGlobal('fetch', fetcher); vi.stubGlobal('createImageBitmap', vi.fn());
    await expect(loadAsset('opaque-view-key', 'missing')).rejects.toThrow('Asset unavailable');
    expect(fetcher).toHaveBeenCalledWith('/v/opaque-view-key/assets/missing');
});
