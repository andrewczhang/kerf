import { afterEach, expect, it, vi } from 'vitest';
import { Sync } from '../src/client/sync';
import { Store } from '../src/client/store';
import { makeNode } from '../src/shared/doc';
class Socket {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    onmessage?: (event: { data: string }) => void;
    send(data: string) { this.sent.push(data); }
    receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}
afterEach(() => vi.unstubAllGlobals());
function setup() {
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
it('restores without pending edits and preserves pending creates across restored deletes', () => {
    const { store, socket } = setup(), n = makeNode('rect', 0, 0);
    store.init([n]); socket.receive({ type: 'restored', ops: [{ t: 'set', id: n.id, key: 'y', value: 50 }] });
    expect(store.doc.get(n.id)?.y).toBe(50);
    const copy = makeNode('rect', 4, 5); store.commit([{ t: 'create', node: copy }]);
    socket.receive({ type: 'restored', ops: [{ t: 'delete', id: copy.id }] });
    expect(store.doc.get(copy.id)).toEqual(copy); expect(store.pending.size).toBe(1);
});
