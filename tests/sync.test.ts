import { afterEach, expect, it, vi } from 'vitest';
import { Sync } from '../src/client/sync';
import { Store } from '../src/client/store';
import { Presence } from '../src/client/presence';
import { Viewport } from '../src/client/viewport';
import { makeNode } from '../src/shared/doc';
import type { Peer } from '../src/shared/protocol';
class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    onmessage?: (event: { data: string }) => void;
    send(data: string) { this.sent.push(data); }
    receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
    vi.useFakeTimers();
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('navigator', { onLine: true });
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    const store = new Store(), sync = new Sync(store, 'test');
    return { store, sync, socket: sync.socket as unknown as Socket };
}
it('reapplies and retains in-transit local edits after restore until ack', () => {
    const { store, socket } = setup(), n = makeNode('rect', 0, 0);
    store.init([n]); store.set(n.id, { x: 20 });
    const pending = new Map(store.pending);
    socket.receive({ type: 'restored', ops: [{ t: 'set', id: n.id, key: 'x', value: 99 }, { t: 'set', id: n.id, key: 'y', value: 50 }] });
    expect(store.doc.get(n.id)).toMatchObject({ x: 20, y: 50 });
    expect(store.pending).toEqual(pending); expect(store.undoStack).toEqual([]);
    socket.receive({ type: 'ack', seq: store.seq }); expect(store.pending.size).toBe(0);
});
it('persists offline edits across refresh and removes acknowledged edits before replay', () => {
    const { store, socket } = setup(), n = makeNode('rect', 0, 0);
    store.init([n]); socket.readyState = 3; store.set(n.id, { x: 40 });
    const refreshed = new Store(), sync = new Sync(refreshed, 'test');
    expect(refreshed.doc.get(n.id)?.x).toBe(40);
    expect(refreshed.pending.size).toBe(1);
    const next = sync.socket as unknown as Socket;
    next.receive({ type: 'init', nodes: [{ ...n, x: 70 }], peers: [], comments: [], versions: [], ackSeq: 1 });
    expect(refreshed.doc.get(n.id)?.x).toBe(70);
    expect(refreshed.pending.size).toBe(0);
    expect(next.sent).toEqual([]);
});
it('replays unacknowledged operations in order after reconnect', () => {
    const { store, socket } = setup(), n = makeNode('rect', 0, 0);
    store.init([n]); store.set(n.id, { x: 40 }); store.set(n.id, { y: 50 });
    socket.receive({ type: 'init', nodes: [n], peers: [], comments: [], versions: [], ackSeq: 0 });
    expect(socket.sent.map(s => JSON.parse(s).seq)).toEqual([1, 2]);
    expect(store.doc.get(n.id)).toMatchObject({ x: 40, y: 50 });
});
it('detects stalled and offline sockets', () => {
    const { sync, socket } = setup();
    Object.assign(socket, { close: vi.fn() });
    vi.advanceTimersByTime(40000);
    expect(sync.status).toBe('Reconnecting');
    expect((socket as unknown as { close: ReturnType<typeof vi.fn> }).close).toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: false }); window.dispatchEvent(new Event('offline'));
    expect(sync.status).toBe('Offline');
});
it('warns before unloading only while operations remain unsynced', () => {
    const { store, socket } = setup();
    const clean = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
    store.commit([{ t: 'create', node: makeNode('rect', 0, 0) }]);
    const dirty = new Event('beforeunload', { cancelable: true }); Object.defineProperty(dirty, 'returnValue', { writable: true, value: undefined }); window.dispatchEvent(dirty); expect(dirty.defaultPrevented).toBe(true); expect(dirty.returnValue).toBe('');
    socket.receive({ type: 'ack', seq: 1 });
    const acked = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(acked); expect(acked.defaultPrevented).toBe(false);
});
it('restores without pending edits and preserves pending creates across restored deletes', () => {
    const { store, socket } = setup(), n = makeNode('rect', 0, 0);
    store.init([n]); socket.receive({ type: 'restored', ops: [{ t: 'set', id: n.id, key: 'y', value: 50 }] });
    expect(store.doc.get(n.id)?.y).toBe(50);
    const copy = makeNode('rect', 4, 5); store.commit([{ t: 'create', node: copy }]);
    socket.receive({ type: 'restored', ops: [{ t: 'delete', id: copy.id }] });
    expect(store.doc.get(copy.id)).toEqual(copy); expect(store.pending.size).toBe(1);
});
it('reports a disconnected send without sending and resumes sends when open', () => {
    const { sync, socket } = setup(); socket.readyState = 3;
    expect(sync.send({ type: 'comment-delete', id: 'one' })).toBe(false);
    expect(socket.sent).toEqual([]); socket.readyState = Socket.OPEN;
    expect(sync.send({ type: 'comment-delete', id: 'one' })).toBe(true);
    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'comment-delete', id: 'one' });
});
function setupPresence(peers: Peer[] = []) {
    const { store, sync, socket } = setup();
    const you: Peer = { id: 'you', name: 'Sam', color: '#a02bbe', cursor: null, selection: [], viewport: { x: 0, y: 0, zoom: 1 } };
    const changed = vi.fn(), viewport = new Viewport(changed);
    const presence = new Presence(sync, viewport, store.selection);
    socket.receive({ type: 'init', nodes: [], comments: [], versions: [], peers, you });
    return { sync, socket, you, viewport, changed, presence };
}
const alex: Peer = { id: 'alex', name: 'Alex', color: '#2364df', cursor: null, selection: [], viewport: { x: 30, y: 40, zoom: 1.5 } };

it('follows pan and zoom changes, but stops on toggle or departure', () => {
    const { socket, viewport, changed, presence } = setupPresence([alex]);
    presence.toggleFollow(alex.id);
    expect(viewport).toMatchObject(alex.viewport);
    socket.receive({ type: 'presence', peer: { ...alex, cursor: { x: 10, y: 10 } } });
    expect(changed).toHaveBeenCalledTimes(1);
    const moved = { x: -10, y: 65, zoom: 2 };
    socket.receive({ type: 'presence', peer: { ...alex, viewport: moved } });
    expect(viewport).toMatchObject(moved);
    presence.toggleFollow(alex.id);
    socket.receive({ type: 'presence', peer: alex });
    expect(viewport).toMatchObject(moved);
    presence.toggleFollow(alex.id);
    socket.receive({ type: 'leave', id: alex.id });
    expect(presence.following).toBeUndefined();
});

it('auto-follows a spotlight on init and respects opting out until it restarts', () => {
    const spotlight = { ...alex, spotlight: true };
    const { socket, viewport, presence } = setupPresence([spotlight]);
    expect(presence.following?.id).toBe(alex.id);
    expect(viewport).toMatchObject(alex.viewport);
    presence.stopFollowing();
    const moved = { ...spotlight, viewport: { x: 0, y: 0, zoom: 2 } };
    socket.receive({ type: 'presence', peer: moved });
    expect(presence.presenter?.id).toBe(alex.id);
    expect(presence.following).toBeUndefined();
    expect(viewport).toMatchObject(alex.viewport);
    socket.receive({ type: 'presence', peer: alex });
    socket.receive({ type: 'presence', peer: moved });
    expect(viewport).toMatchObject(moved.viewport);
    socket.receive({ type: 'presence', peer: alex });
    expect(presence.following).toBeUndefined();
    expect(presence.presenter).toBeUndefined();
});

it('sends spotlight toggles and handles the spotlight acknowledgement as local presence', () => {
    const { sync, socket, presence, you } = setupPresence([alex]);
    presence.toggleFollow(alex.id);
    presence.toggleSpotlight();
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'presence', spotlight: true });
    socket.receive({ type: 'presence', peer: { ...you, spotlight: true } });
    expect(presence.presenting).toBe(true);
    expect(sync.peers.has(you.id)).toBe(false);
    expect(presence.following).toBeUndefined();
    presence.toggleSpotlight();
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ type: 'presence', spotlight: false });
    socket.receive({ type: 'presence', peer: { ...you, spotlight: false } });
    expect(presence.presenting).toBe(false);
});
