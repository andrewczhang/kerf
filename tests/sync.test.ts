import { afterEach, expect, it, vi } from 'vitest';
import { Sync } from '../src/client/sync';
import { Store } from '../src/client/store';
import { Presence } from '../src/client/presence';
import { Select } from '../src/client/tools/select';
import { Viewport } from '../src/client/viewport';
import type { Peer } from '../src/shared/protocol';
import { applyOp, makeNode, type Doc } from '../src/shared/doc';
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
    vi.stubGlobal('navigator', { onLine: true, locks: { request: (_name: string, _options: unknown, callback: (lock: object) => unknown) => Promise.resolve(callback({})) } });
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    vi.stubGlobal('WebSocket', Socket);
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' });
    const store = new Store(), sync = new Sync(store, 'test');
    return { store, sync, socket: sync.socket as unknown as Socket };
}
it('receives initial and broadcast names without adding undo history', () => {
    const { store, sync, socket } = setup();
    const changed = vi.fn(); sync.addEventListener('name-change', changed);
    socket.receive({ type: 'init', name: 'Initial name', nodes: [], peers: [], comments: [], versions: [] });
    expect(sync.name).toBe('Initial name');
    socket.receive({ type: 'name', name: 'Remote name' });
    expect(sync.name).toBe('Remote name'); expect(changed).toHaveBeenCalledTimes(2);
    expect(store.undoStack).toEqual([]); expect(store.pending.size).toBe(0);
});
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
    store.init([n]); socket.readyState = 3; store.set(n.id, { x: 40 }); window.dispatchEvent(new Event('pagehide'));
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
it('advances past server receipts when local sequence storage is lost, including edits before init', () => {
    const { store, socket } = setup(), node = makeNode('rect', 0, 0);
    store.commit([{ t: 'create', node }]);
    socket.receive({ type: 'init', nodes: [], peers: [], comments: [], versions: [], ackSeq: 15 });
    expect(store.seq).toBe(16); expect(store.doc.has(node.id)).toBe(true);
    expect(JSON.parse(socket.sent[0]).seq).toBe(16);
    store.set(node.id, { x: 20 }); expect(JSON.parse(socket.sent[1]).seq).toBe(17);
});
it('renumbers the entire unsent queue in order when it crosses the server receipt', () => {
    const { store, socket } = setup(), node = makeNode('rect', 0, 0);
    store.commit([{ t: 'create', node }]); store.set(node.id, { x: 90 });
    socket.receive({ type: 'init', nodes: [], peers: [], comments: [], versions: [], ackSeq: 1 });
    const messages = socket.sent.map(raw => JSON.parse(raw));
    expect(messages.map(m => m.seq)).toEqual([3, 4]);
    expect(messages.map(m => m.ops[0].t)).toEqual(['create', 'set']);
    expect(store.doc.get(node.id)?.x).toBe(90);
    const server: Doc = new Map();
    for (const m of messages) for (const op of m.ops) applyOp(server, op);
    expect(server.get(node.id)?.x).toBe(90);
    store.set(node.id, { y: 80 }); expect(store.seq).toBe(5);
});
it('durably saves renumbered replay and its snapshot before the first socket send', () => {
    const { store, sync, socket } = setup(), node = makeNode('rect', 0, 0);
    store.commit([{ t: 'create', node }]); store.set(node.id, { x: 90 });
    const send = vi.spyOn(socket, 'send').mockImplementation(() => {
        const saved = JSON.parse(localStorage.getItem(sync.storageKey)!);
        expect(saved.seq).toBe(4); expect(saved.pending.map(([seq]: [number]) => seq)).toEqual([3, 4]);
        const snapshot = JSON.parse(localStorage.getItem(sync.storageKey + ':nodes')!);
        expect(snapshot.seq).toBe(4); expect(snapshot.nodes[0].x).toBe(90);
    });
    socket.receive({ type: 'init', nodes: [], peers: [], comments: [], versions: [], ackSeq: 1 });
    expect(send).toHaveBeenCalledTimes(2);
});
it('gives a duplicated live tab a fresh identity and sequence without claiming the original queue', () => {
    const { store, sync } = setup();
    store.commit([{ t: 'create', node: makeNode('rect', 0, 0) }]);
    let calls = 0;
    vi.stubGlobal('navigator', { onLine: true, locks: { request: (_name: string, _options: unknown, callback: (lock: object | null) => unknown) => Promise.resolve(callback(calls++ ? {} : null)) } });
    const duplicate = new Store(), second = new Sync(duplicate, 'test');
    expect(second.clientId).not.toBe(sync.clientId); expect(duplicate.seq).toBe(0); expect(duplicate.pending.size).toBe(0);
    expect(store.pending.size).toBe(1);
    expect(calls).toBe(2);
});
it('shows an offline create locally after refresh and init and replays it to the server', () => {
    const { store } = setup(), n = makeNode('rect', 20, 30);
    store.commit([{ t: 'create', node: n }]); window.dispatchEvent(new Event('pagehide'));
    const refreshed = new Store(), sync = new Sync(refreshed, 'test'), socket = sync.socket as unknown as Socket;
    socket.receive({ type: 'init', nodes: [], peers: [], comments: [], versions: [], ackSeq: 0 });
    expect(refreshed.doc.get(n.id)).toEqual(n);
    const server: Doc = new Map();
    for (const raw of socket.sent) { const message = JSON.parse(raw); for (const op of message.ops ?? []) applyOp(server, op); }
    expect(server.get(n.id)).toEqual(n);
});
it('restores snapshot operations once without deleting layers moved into an undone frame', () => {
    const { store } = setup(), frame = makeNode('frame', 0, 0), child = makeNode('rect', 20, 30);
    store.init([frame, child]); store.commit([{ t: 'delete', id: frame.id }]); store.history();
    store.set(child.id, { parent: frame.id }); window.dispatchEvent(new Event('pagehide'));
    const refreshed = new Store(); new Sync(refreshed, 'test');
    expect(refreshed.doc.get(child.id)?.parent).toBe(frame.id);
    expect(refreshed.pending.size).toBe(3);
});
it('applies only operations newer than a throttled snapshot when recovering offline', () => {
    const { store } = setup(), node = makeNode('rect', 0, 0);
    store.commit([{ t: 'create', node }]); vi.advanceTimersByTime(250);
    store.set(node.id, { x: 70 });
    const refreshed = new Store(); new Sync(refreshed, 'test');
    expect(refreshed.doc.get(node.id)?.x).toBe(70);
});
it('throttles snapshot serialization while keeping queue writes and pagehide synchronous', () => {
    const { store } = setup(); const setItem = vi.spyOn(localStorage, 'setItem');
    for (let i = 0; i < 50; i++) store.changed();
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(setItem.mock.calls.filter(([key]) => key.endsWith(':nodes'))).toHaveLength(1);
    setItem.mockClear(); store.commit([{ t: 'create', node: makeNode('rect', 0, 0) }]);
    expect(setItem.mock.calls.filter(([key]) => !key.endsWith(':nodes'))).toHaveLength(1);
    expect(setItem.mock.calls.filter(([key]) => key.endsWith(':nodes'))).toHaveLength(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(setItem.mock.calls.filter(([key]) => key.endsWith(':nodes'))).toHaveLength(1);
});
it('defers full snapshots until edits pause, but durably writes pending operations during the drag', () => {
    const { store, sync } = setup(), node = makeNode('rect', 0, 0);
    store.init([node]); vi.advanceTimersByTime(250);
    const setItem = vi.spyOn(localStorage, 'setItem');
    for (let i = 1; i <= 10; i++) { store.set(node.id, { x: i }); vi.advanceTimersByTime(100); }
    expect(setItem.mock.calls.filter(([key]) => key.endsWith(':nodes'))).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem(sync.storageKey)!).pending).toHaveLength(10);
    vi.advanceTimersByTime(150);
    expect(JSON.parse(localStorage.getItem(sync.storageKey + ':nodes')!).nodes[0].x).toBe(10);
    store.set(node.id, { x: 20 }); window.dispatchEvent(new Event('pagehide'));
    expect(JSON.parse(localStorage.getItem(sync.storageKey + ':nodes')!).nodes[0].x).toBe(20);
    const restored = new Store(); new Sync(restored, 'test');
    expect(restored.doc.get(node.id)?.x).toBe(20);
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
it('merges peer text with pending typing and reconciles the text echoed by the room', () => {
    const { store, socket } = setup(), n = { ...makeNode('text', 0, 0), text: 'WEEKEND STUDIO' };
    socket.receive({ type: 'init', nodes: [n], comments: [], versions: [], peers: [] });
    store.editText(n.id, n.text, n.text + ' HQ');
    expect(JSON.parse(socket.sent[0]).ops[0]).toMatchObject({ baseText: n.text, value: n.text + ' HQ' });
    socket.receive({ type: 'ops', ops: [{ t: 'set', id: n.id, key: 'text', value: 'THE ' + n.text }] });
    expect(store.doc.get(n.id)?.text).toBe('THE WEEKEND STUDIO HQ');
    socket.receive({ type: 'ack', seq: 1, text: [{ t: 'set', id: n.id, key: 'text', value: 'THE WEEKEND STUDIO HQ' }] });
    expect(store.doc.get(n.id)?.text).toBe('THE WEEKEND STUDIO HQ');
    expect(store.pending.size).toBe(0);
});
it('does not optimistically reapply text already acknowledged in the reconnect snapshot', () => {
    const { store, sync, socket } = setup(), n = { ...makeNode('text', 0, 0), text: 'STUDIO' };
    const init = { type: 'init', nodes: [n], comments: [], versions: [], peers: [], epoch: 0 };
    socket.receive(init);
    store.editText(n.id, n.text, 'THE STUDIO');
    sync.connect();
    const resumed = sync.socket as unknown as Socket;
    resumed.receive({ ...init, nodes: [{ ...n, text: 'THE STUDIO HQ' }], ackSeq: 1 });
    expect(store.doc.get(n.id)?.text).toBe('THE STUDIO HQ');
    expect(store.pending.size).toBe(0);
    expect(resumed.sent).toEqual([]);
});
it('discards a queued old-epoch drag and ignores its continuation and mouse-up after restore', () => {
    const { store, socket, sync } = setup(), n = makeNode('rect', 100, 141);
    const select = new Select({ store, viewport: new Viewport(() => {}), invalidate() {} });
    sync.addEventListener('restored', () => select.cancelGesture());
    socket.receive({ type: 'init', nodes: [n], comments: [], versions: [], peers: [], epoch: 0 });
    const down = { buttons: 1 } as PointerEvent;
    select.onPointerDown({ x: 150, y: 191 }, down);
    select.onPointerMove({ x: 150, y: 248 }, down);
    expect(store.doc.get(n.id)?.y).toBe(198);
    expect(JSON.parse(socket.sent.at(-1)!).epoch).toBe(0);
    socket.receive({ type: 'restored', epoch: 1, nodes: [n], ops: [] });
    expect(store.pending.size).toBe(0);
    const sent = socket.sent.length;
    select.onPointerMove({ x: 150, y: 260 }, down); select.onPointerUp({ x: 150, y: 260 });
    expect(store.doc.get(n.id)?.y).toBe(141);
    expect(socket.sent).toHaveLength(sent);
    select.onPointerDown({ x: 150, y: 191 }, down);
    select.onPointerMove({ x: 150, y: 200 }, down); select.onPointerUp({ x: 150, y: 200 });
    expect(store.doc.get(n.id)?.y).toBe(150);
    expect(JSON.parse(socket.sent.at(-1)!).epoch).toBe(1);
    store.history(); expect(store.doc.get(n.id)?.y).toBe(141);
});
