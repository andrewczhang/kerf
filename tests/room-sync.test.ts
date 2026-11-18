import { afterEach, expect, it, vi } from 'vitest';
import type { DurableObjectState, DurableObjectNamespace, Request as WorkerRequest } from '@cloudflare/workers-types';
import { Room } from '../worker/room';
import { makeNode } from '../src/shared/doc';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';

afterEach(() => vi.unstubAllGlobals());
it('persists large text, answers heartbeats, and deduplicates retries across connections and room reloads', async () => {
    class Socket extends EventTarget {
        sent: ServerMsg[] = [];
        accept() {}
        send(data: string) { this.sent.push(JSON.parse(data)); }
    }
    let socket: Socket;
    vi.stubGlobal('WebSocketPair', class { 0 = new Socket(); 1 = socket = new Socket(); });
    vi.stubGlobal('Response', class {});
    const data = new Map<string, unknown>();
    let work: Promise<unknown> = Promise.resolve();
    const state = {
        blockConcurrencyWhile(fn: () => Promise<unknown>) { work = fn(); return work; },
        storage: {
            async get(key: string) { return data.get(key); },
            async put(key: string | Record<string, unknown>, value?: unknown) {
                if (typeof key === 'string') data.set(key, structuredClone(value));
                else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v));
            },
        },
    } as unknown as DurableObjectState;
    const env = { ROOM: {} as DurableObjectNamespace };
    let room = new Room(state, env); await work;
    const connect = async () => { await room.fetch(new Request('http://localhost/f/test/ws?clientId=stable', { headers: { Upgrade: 'websocket', 'x-kerf-role': 'edit' } }) as unknown as WorkerRequest); return socket!; };
    let ws = await connect();
    const send = async (msg: ClientMsg) => { ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) })); await work; };
    await send({ type: 'ping' }); expect(ws.sent.at(-1)).toEqual({ type: 'pong' });
    const node = { ...makeNode('text', 0, 0), text: '界'.repeat(100000) };
    await send({ type: 'ops', seq: 1, ops: [{ t: 'create', node }] });
    await send({ type: 'ops', seq: 2, ops: [{ t: 'set', id: node.id, key: 'x', value: 50 }] });
    await send({ type: 'rename', name: '  Layout\n study ' });
    expect(ws.sent.at(-1)).toEqual({ type: 'name', name: 'Layout study' });
    expect(data.get('file-name')).toBe('Layout study');
    room = new Room(state, env); await work; ws = await connect();
    expect(ws.sent[0]).toMatchObject({ type: 'init', name: 'Layout study', ackSeq: 2, nodes: [{ text: node.text, x: 50 }] });
    await send({ type: 'ops', seq: 1, ops: [{ t: 'set', id: node.id, key: 'x', value: 999 }] });
    expect(room.doc.get(node.id)?.x).toBe(50);
    expect(ws.sent.at(-1)).toEqual({ type: 'ack', seq: 1 });
});
