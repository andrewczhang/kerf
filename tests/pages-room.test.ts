import { afterEach, expect, it, vi } from 'vitest';
import type { DurableObjectState, Request as WorkerRequest } from '@cloudflare/workers-types';
import { Room } from '../worker/room';
import { makeNode, type Node } from '../src/shared/doc';
import type { ClientMsg, ServerMsg } from '../src/shared/protocol';

afterEach(() => vi.unstubAllGlobals());
it('accepts page ops, ignores duplicate migration creates, relays page presence and reconciles last-page deletion', async () => {
    class Socket extends EventTarget { sent: ServerMsg[] = []; accept() {} send(data: string) { this.sent.push(JSON.parse(data)); } }
    let socket: Socket;
    vi.stubGlobal('WebSocketPair', class { 0 = new Socket(); 1 = socket = new Socket(); }); vi.stubGlobal('Response', class {});
    const data = new Map<string, unknown>(); let work: Promise<unknown> = Promise.resolve();
    const state = { blockConcurrencyWhile(fn: () => Promise<unknown>) { work = fn(); return work; }, storage: {
        async get(key: string) { return data.get(key); },
        async put(key: string | Record<string, unknown>, value?: unknown) { if (typeof key === 'string') data.set(key, structuredClone(value)); else for (const [k, v] of Object.entries(key)) data.set(k, structuredClone(v)); },
    } } as unknown as DurableObjectState;
    const room = new Room(state); await work;
    const connect = async (id: string) => { await room.fetch(new Request('http://localhost/f/pages/ws?clientId=' + id, { headers: { Upgrade: 'websocket' } }) as unknown as WorkerRequest); return socket!; };
    const a = await connect('a'), b = await connect('b');
    const send = async (ws: Socket, msg: ClientMsg) => { ws.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(msg) })); await work; };
    const first = { ...makeNode('page', 0, 0), id: 'page-1', name: 'Page 1' }, second = { ...makeNode('page', 0, 0, 'V'), id: 'page-2' }, rect = { ...makeNode('rect', 20, 30), parent: first.id };
    await send(a, { type: 'ops', seq: 1, ops: [first, second, rect].map(node => ({ t: 'create', node })) });
    await send(a, { type: 'ops', seq: 2, ops: [{ t: 'set', id: first.id, key: 'name', value: 'Renamed' }] });
    await send(b, { type: 'ops', seq: 1, ops: [{ t: 'create', node: first }, { t: 'create', node: { ...makeNode('page', 0, 0), id: 'nested', parent: first.id } }] });
    expect((data.get('nodes') as Node[]).find(n => n.id === first.id)?.name).toBe('Renamed'); expect((data.get('nodes') as Node[]).some(n => n.id === 'nested')).toBe(false);
    await send(a, { type: 'presence', page: second.id, cursor: { x: 10, y: 20 }, selection: [], name: 'Alex', viewport: { x: 0, y: 0, zoom: 1 } });
    const presence = b.sent.filter(m => m.type === 'presence').at(-1); expect(presence?.type === 'presence' && presence.peer.page).toBe(second.id);
    await send(a, { type: 'ops', seq: 3, ops: [{ t: 'delete', id: first.id }] });
    await send(b, { type: 'ops', seq: 2, ops: [{ t: 'delete', id: second.id }] });
    expect((data.get('nodes') as Node[]).map(n => n.id)).toEqual([second.id]);
    for (const ws of [a, b]) { const snap = ws.sent.filter(m => m.type === 'pages-state').at(-1); expect(snap?.type === 'pages-state' && snap.nodes.map(n => n.id)).toEqual([second.id]); }
    const ack = b.sent.findIndex(m => m.type === 'ack' && m.seq === 2), snap = b.sent.map(m => m.type).lastIndexOf('pages-state'); expect(snap).toBeGreaterThan(ack);
});
