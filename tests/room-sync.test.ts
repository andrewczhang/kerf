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
    const sockets = new Set<Socket>();
    let work: Promise<unknown> = Promise.resolve();
    const setWebSocketAutoResponse = vi.fn();
    const state = {
        setWebSocketAutoResponse,
        acceptWebSocket(ws: Socket) { sockets.add(ws); },
        getWebSockets() { return [...sockets]; },
        blockConcurrencyWhile(fn: () => Promise<unknown>) { work = fn(); return work; },
        storage: {
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
        data, sockets, setWebSocketAutoResponse,
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
    const harness = setup(), { data, sockets, connect, send, wake } = harness;
    const a = await connect(), viewer = await connect('other', 'view');
    const init = a.sent[0], viewerInit = viewer.sent[0];
    if (init.type !== 'init' || viewerInit.type !== 'init') throw Error('Missing init');
    const selection = Array.from({ length: 600 }, () => crypto.randomUUID());
    const presence = { type: 'presence' as const, name: 'Ada', selection, cursor: { x: 1, y: 2 }, page: 'page-2', viewport: { x: 3, y: 4, zoom: 2 }, spotlight: true };
    await send(a, presence);
    const overflowKey = 'socket:' + init.you.id, storedSelection = data.get(overflowKey);
    expect(storedSelection).toEqual(selection);
    const cursor = { x: 5, y: 6 };
    await send(a, { ...presence, selection: [...selection], cursor });
    expect(data.get(overflowKey)).toBe(storedSelection);
    const disconnected = await connect('disconnected'), disconnectedInit = disconnected.sent[0];
    if (disconnectedInit.type !== 'init') throw Error('Missing init');
    await send(disconnected, { ...presence, spotlight: false });
    const orphanKey = 'socket:' + disconnectedInit.you.id;
    expect(data.has(orphanKey)).toBe(true);
    sockets.delete(disconnected);
    await wake();
    expect(data.has(orphanKey)).toBe(false);
    expect(data.get(overflowKey)).toBe(storedSelection);
    const late = await connect('late'), lateInit = late.sent[0];
    expect(lateInit).toMatchObject({ type: 'init', peers: [{ id: init.you.id, name: 'Ada', selection, cursor, page: 'page-2', spotlight: true }, { id: viewerInit.you.id }] });
    const changedSelection = selection.slice(1);
    await send(a, { ...presence, selection: changedSelection, cursor });
    expect(data.get(overflowKey)).toEqual(changedSelection);

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
    expect(data.has(overflowKey)).toBe(false);
});
