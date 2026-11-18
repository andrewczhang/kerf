import { afterEach, expect, it, vi } from 'vitest';
import type { DurableObjectState, DurableObjectNamespace, Request as WorkerRequest, WebSocket } from '@cloudflare/workers-types';
import { Room } from '../worker/room';
import { makeNode } from '../src/shared/doc';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';

afterEach(() => vi.unstubAllGlobals());
class Socket {
    sent: ServerMsg[] = [];
    attachment?: Uint8Array;
    serializeAttachment(data: Uint8Array) { this.attachment = structuredClone(data); }
    deserializeAttachment() { return this.attachment; }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() {}
}
const workerSocket = (socket: Socket) => socket as unknown as WebSocket;
function setup() {
    let socket: Socket;
    vi.stubGlobal('WebSocketPair', class { 0 = new Socket(); 1 = socket = new Socket(); });
    vi.stubGlobal('WebSocketRequestResponsePair', class { constructor(public request: string, public response: string) {} });
    vi.stubGlobal('Response', class {});
    const data = new Map<string, unknown>();
    const selections = new Map<string, string>();
    const selectionReads: string[] = [];
    let hasSelectionTable = false;
    const sockets = new Set<Socket>();
    let work: Promise<unknown> = Promise.resolve();
    const setWebSocketAutoResponse = vi.fn();
    const state = {
        setWebSocketAutoResponse,
        acceptWebSocket(ws: Socket) { sockets.add(ws); },
        getWebSockets() { return [...sockets]; },
        blockConcurrencyWhile(fn: () => Promise<unknown>) { work = fn(); return work; },
        storage: {
            sql: {
                exec(query: string, id: string, selection: string) {
                    if (query.startsWith('SELECT name FROM sqlite_schema')) return { toArray: () => hasSelectionTable ? [{ name: 'room_selections' }] : [] };
                    if (query.startsWith('CREATE TABLE IF NOT EXISTS room_selections')) hasSelectionTable = true;
                    else if (query.startsWith('INSERT OR REPLACE INTO room_selections')) selections.set(id, selection);
                    else if (query === 'SELECT selection FROM room_selections WHERE peer_id = ?') {
                        selectionReads.push(id);
                        return { toArray: () => selections.has(id) ? [{ selection: selections.get(id) }] : [] };
                    } else if (query === 'DELETE FROM room_selections WHERE peer_id = ?') selections.delete(id);
                    else if (query.startsWith('DELETE FROM room_selections WHERE peer_id NOT IN')) {
                        const live = new Set(JSON.parse(id));
                        for (const key of selections.keys()) if (!live.has(key)) selections.delete(key);
                    } else throw Error('Unexpected query: ' + query);
                },
            },
            async get(key: string) { return data.get(key); },
            async list({ prefix }: { prefix: string }) { return new Map([...data].filter(([key]) => key.startsWith(prefix))); },
            async transaction(fn: (txn: unknown) => Promise<unknown>) { return fn(this); },
            async delete(keys: string | string[]) { for (const key of typeof keys === 'string' ? [keys] : keys) data.delete(key); },
            async put(key: string | Record<string, unknown>, value?: unknown) {
                if (typeof key === 'string') data.set(key, structuredClone(value));
                else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v));
            },
        },
    } as unknown as DurableObjectState;
    const env = { ROOM: {} as DurableObjectNamespace };
    let room = new Room(state, env);
    return {
        data, selections, selectionReads, sockets, setWebSocketAutoResponse,
        get room() { return room; },
        async wake() { await work; room = new Room(state, env); await work; },
        async connect(clientId = 'stable', role = 'edit') {
            await work;
            await room.fetch(new Request('http://localhost/f/test/ws?clientId=' + clientId, { headers: { Upgrade: 'websocket', 'x-kerf-role': role } }) as unknown as WorkerRequest);
            return socket!;
        },
        send(ws: Socket, msg: ClientMsg) { return room.webSocketMessage(workerSocket(ws), JSON.stringify(msg)); },
    };
}
it('persists large text, answers heartbeats, and deduplicates retries across connections and room reloads', async () => {
    const harness = setup(), { data, sockets, connect, setWebSocketAutoResponse } = harness;
    let ws = await connect();
    const send = (msg: ClientMsg) => harness.send(ws, msg);
    expect(setWebSocketAutoResponse).toHaveBeenCalledWith({ request: '{"type":"ping"}', response: '{"type":"pong"}' });
    await send({ type: 'ping' }); expect(ws.sent.at(-1)).toEqual({ type: 'pong' });
    const node = { ...makeNode('text', 0, 0), text: '界'.repeat(100000) };
    await send({ type: 'ops', seq: 1, ops: [{ t: 'create', node }] });
    await send({ type: 'ops', seq: 2, ops: [{ t: 'set', id: node.id, key: 'x', value: 50 }] });
    await send({ type: 'rename', name: '  Layout\n study ' });
    expect(ws.sent.at(-1)).toEqual({ type: 'name', name: 'Layout study' });
    expect(data.get('file-name')).toBe('Layout study');
    sockets.delete(ws);
    await harness.wake(); ws = await connect();
    expect(ws.sent[0]).toMatchObject({ type: 'init', name: 'Layout study', ackSeq: 2, nodes: [{ text: node.text, x: 50 }] });
    await send({ type: 'ops', seq: 1, ops: [{ t: 'set', id: node.id, key: 'x', value: 999 }] });
    expect(harness.room.doc.get(node.id)?.x).toBe(50);
    expect(ws.sent.at(-1)).toEqual({ type: 'ack', seq: 1 });
});
it('restores connected peers, spotlight and roles, then relays edits and departure without reconnecting', async () => {
    const harness = setup(), { data, selections, selectionReads, sockets, connect, send, wake } = harness;
    const a = await connect(), viewer = await connect('other', 'view');
    const init = a.sent[0], viewerInit = viewer.sent[0];
    if (init.type !== 'init' || viewerInit.type !== 'init') throw Error('Missing init');
    const selection = Array.from({ length: 600 }, () => crypto.randomUUID());
    const presence = { type: 'presence' as const, name: 'Ada', selection, cursor: { x: 1, y: 2 }, page: 'page-2', viewport: { x: 3, y: 4, zoom: 2 }, spotlight: true };
    await send(a, presence);
    const overflowKey = init.you.id, storedSelection = selections.get(overflowKey);
    expect(storedSelection).toBe(JSON.stringify(selection));
    const originalWrite = vi.spyOn(selections, 'set');
    const cursor = { x: 5, y: 6 };
    await send(a, { ...presence, selection: [...selection], cursor });
    expect(originalWrite).not.toHaveBeenCalled();
    const disconnected = await connect('disconnected'), disconnectedInit = disconnected.sent[0];
    if (disconnectedInit.type !== 'init') throw Error('Missing init');
    await send(disconnected, { ...presence, spotlight: false });
    const orphanKey = disconnectedInit.you.id;
    expect(selections.has(orphanKey)).toBe(true);
    sockets.delete(disconnected);
    await wake();
    expect(selections.has(orphanKey)).toBe(false);
    expect(selectionReads).toEqual([overflowKey]);
    expect(selections.get(overflowKey)).toBe(storedSelection);
    const late = await connect('late'), lateInit = late.sent[0];
    expect(lateInit).toMatchObject({ type: 'init', peers: [{ id: init.you.id, name: 'Ada', selection, cursor, page: 'page-2', spotlight: true }, { id: viewerInit.you.id }] });
    const changedSelection = selection.slice(1);
    await send(a, { ...presence, selection: changedSelection, cursor });
    expect(selections.get(overflowKey)).toBe(JSON.stringify(changedSelection));

    const node = { ...makeNode('rect', 1, 2) };
    await send(viewer, { type: 'ops', seq: 1, ops: [{ t: 'create', node }] });
    expect(viewer.sent.at(-1)).toMatchObject({ type: 'error', message: 'View only' });
    await send(a, { type: 'ops', seq: 1, ops: [{ t: 'create', node }] });
    expect(a.sent).toContainEqual({ type: 'ack', seq: 1 });
    expect(viewer.sent).toContainEqual({ type: 'ops', from: init.you.id, ops: [{ t: 'create', node }] });
    expect(data.get('receipt:stable')).toBe(1);

    await send(viewer, { type: 'presence', name: 'Viewer', selection: [], cursor: null, viewport: { x: 0, y: 0, zoom: 1 }, spotlight: true });
    await wake();
    expect((await connect('latest')).sent[0]).toMatchObject({ type: 'init', peers: [{ id: init.you.id, spotlight: false }, { id: viewerInit.you.id, spotlight: true }, {}] });
    sockets.delete(a);
    await harness.room.webSocketClose(workerSocket(a), 1000, '');
    expect(viewer.sent.at(-1)).toEqual({ type: 'leave', id: init.you.id });
    expect(selections.has(overflowKey)).toBe(false);
});
it('bounds presence metadata and selection before persisting it', async () => {
    const { connect, send, selections } = setup();
    const sender = await connect(), receiver = await connect('receiver');
    const init = sender.sent[0];
    if (init.type !== 'init') throw Error('Missing init');
    const viewport = { x: 1, y: 2, zoom: 1, extra: 'x'.repeat(16384) };
    const cursor = { x: 3, y: 4, extra: viewport.extra };
    const selection = ['x'.repeat(129), ...Array.from({ length: 4096 }, () => crypto.randomUUID())];
    await send(sender, { type: 'presence', name: 'n'.repeat(33), cursor, viewport, selection, page: 'p'.repeat(129) });
    expect(receiver.sent.at(-1)).toMatchObject({ type: 'presence', peer: { name: 'n'.repeat(32), selection: selection.slice(1, 4096) } });
    const peer = JSON.parse(new TextDecoder().decode(sender.attachment)).peer;
    expect(peer).toEqual({ id: init.you.id, color: init.you.color, name: 'n'.repeat(32), cursor: { x: 3, y: 4 }, viewport: { x: 1, y: 2, zoom: 1 }, selection: [] });
    expect(selections.get(init.you.id)).toBe(JSON.stringify(selection.slice(1, 4096)));
});
it('does not write an overflow row if attachment serialization fails', async () => {
    const { connect, send, selections } = setup();
    const sender = await connect();
    const close = vi.spyOn(sender, 'close');
    vi.spyOn(sender, 'serializeAttachment').mockImplementation(() => { throw Error('Attachment could not be written'); });
    await send(sender, { type: 'presence', name: 'Ada', cursor: null, viewport: { x: 0, y: 0, zoom: 1 }, selection: Array.from({ length: 600 }, () => crypto.randomUUID()) });
    expect(selections.size).toBe(0);
    expect(close).toHaveBeenCalledWith(1003, 'Invalid message');
});
