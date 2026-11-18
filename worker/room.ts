import type { WebSocket, DurableObjectState, DurableObjectNamespace, Request as WorkerRequest } from '@cloudflare/workers-types';
import { applyOp, isTextNode, type Op } from '../src/shared/doc';
import { StoredDocument } from './document';
import { applyLayout } from '../src/shared/layout';
import type { ClientMsg, Peer, Role, ServerMsg } from '../src/shared/protocol';
import { MAX_OPS } from '../src/shared/protocol';
import { Features } from './features';
import { resolveStyleOps } from '../src/shared/styles';
import { sanitizeFileName } from '../src/shared/file-name';
declare const WebSocketPair: typeof import('@cloudflare/workers-types').WebSocketPair;
declare const WebSocketRequestResponsePair: typeof import('@cloudflare/workers-types').WebSocketRequestResponsePair;
declare const Response: typeof import('@cloudflare/workers-types').Response;
declare const Request: typeof import('@cloudflare/workers-types').Request;
type Connection = { peer: Peer; role: Role; receiptKey?: string; joinedEpoch: number; target: string; overflow?: boolean };
export class Room {
    doc = new StoredDocument();
    name = '';
    private connections = new Map<WebSocket, Connection>();
    private departed = new WeakSet<WebSocket>();
    features: Features;
    constructor(private state: DurableObjectState, private env: { ROOM: DurableObjectNamespace }) {
        this.features = new Features(state.storage, this.doc, m => this.broadcast(m));
        state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'));
        state.blockConcurrencyWhile(async () => {
            this.name = await state.storage.get<string>('file-name') ?? '';
            await this.doc.load(state.storage);
            await this.features.load();
            const overflow = await state.storage.list<string[]>({ prefix: 'socket:' });
            for (const ws of state.getWebSockets()) {
                const connection = this.attachment(ws);
                if (!connection) continue;
                if (connection.overflow) {
                    const key = 'socket:' + connection.peer.id;
                    connection.peer.selection = overflow.get(key) ?? [];
                    overflow.delete(key);
                }
                this.connections.set(ws, connection);
            }
            const stale = [...overflow.keys()];
            for (let i = 0; i < stale.length; i += 128) await state.storage.delete(stale.slice(i, i + 128));
        });
    }
    private attachment(ws: WebSocket): Connection | undefined {
        const data = ws.deserializeAttachment();
        if (data instanceof Uint8Array) return JSON.parse(new TextDecoder().decode(data));
    }
    private saveConnection(ws: WebSocket, connection: Connection, selectionChanged = false) {
        const id = connection.peer.id, key = 'socket:' + id, encoder = new TextEncoder();
        const data = encoder.encode(JSON.stringify({ ...connection, overflow: undefined }));
        // Leave room for the structured-clone header within the 16 KiB attachment limit.
        if (data.length <= 16000) {
            ws.serializeAttachment(data);
            if (connection.overflow) {
                connection.overflow = undefined;
                return this.state.storage.delete(key);
            }
            return;
        }
        const attachment = encoder.encode(JSON.stringify({ ...connection, peer: { ...connection.peer, selection: [] }, overflow: true }));
        const attach = () => {
            ws.serializeAttachment(attachment);
            connection.overflow = true;
        };
        if (!connection.overflow || selectionChanged) return this.state.storage.put(key, connection.peer.selection).then(attach);
        attach();
    }
    send(ws: WebSocket, msg: ServerMsg) { try {
        ws.send(JSON.stringify(msg));
    }
    catch {} }
    broadcast(msg: ServerMsg, except?: WebSocket) { for (const ws of this.connections.keys())
        if (ws !== except)
            this.send(ws, msg); }
    canonicalText(op: Op): Op[] {
        if (op?.t !== 'set' || op.key !== 'text' || op.baseText === undefined) return [];
        const n = this.doc.get(op.id);
        return isTextNode(n) ? [{ t: 'set', id: op.id, key: 'text', value: n.text }] : [];
    }
    async fetch(req: WorkerRequest) {
        const url = new URL(req.url);
        if (url.pathname === '/_internal/register-view' && req.method === 'POST') {
            const target = await req.text(), old = await this.state.storage.get<string>('target');
            if (old && old !== target) return new Response('Conflict', { status: 409 });
            await this.state.storage.put('target', target); return new Response(null, { status: 204 });
        }
        const role = req.headers.get('x-kerf-role') === 'edit' ? 'edit' : 'view';
        if (url.pathname.startsWith('/v/')) {
            if (req.method !== 'GET') return new Response('View only', { status: 403 });
            const target = await this.state.storage.get<string>('target');
            if (!target) return new Response('Not found', { status: 404 });
            const headers = new Headers(req.headers); headers.set('x-kerf-role', 'view');
            url.pathname = url.pathname.replace(/^\/v\/[^/]+/, '/f/' + target);
            return this.env.ROOM.get(this.env.ROOM.idFromName(target)).fetch(new Request(url.toString(), { method: req.method, headers }));
        }
        const asset = new URL(req.url).pathname.match(/\/assets\/([^/]+)$/);
        if (asset) {
            if (role === 'view' && req.method !== 'GET') return new Response('View only', { status: 403 });
            const hash = asset[1]; if (!/^[\da-f]{64}$/.test(hash)) return new Response('Invalid hash', { status: 400 });
            if (req.method === 'GET') { const value = await this.state.storage.get<{ type: string; bytes: ArrayBuffer }>('asset:' + hash); return value ? new Response(value.bytes, { headers: { 'content-type': value.type, 'cache-control': 'public, max-age=31536000, immutable' } }) : new Response('Not found', { status: 404 }); }
            if (req.method !== 'PUT') return new Response('Method not allowed', { status: 405 });
            const type = req.headers.get('content-type') || ''; if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) return new Response('Unsupported image type', { status: 415 });
            const limit = 1.5 * 1024 * 1024; if (Number(req.headers.get('content-length')) > limit) return new Response('Image too large', { status: 413 });
            const reader = req.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
            if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); return new Response('Image too large', { status: 413 }); } chunks.push(value); }
            const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); if (actual !== hash) return new Response('Hash mismatch', { status: 400 });
            await this.state.storage.put('asset:' + hash, { type, bytes: bytes.buffer }); return new Response(null, { status: 204 });
        }
        if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
            return new Response('WebSocket required', { status: 426 });
        const pair = new WebSocketPair();
        const [client, ws] = Object.values(pair);
        const clientId = url.searchParams.get('clientId');
        const receiptKey = clientId ? 'receipt:' + clientId : undefined;
        const ackSeq = receiptKey ? await this.state.storage.get<number>(receiptKey) ?? 0 : 0;
        const palette = ['#2364df', '#a02bbe', '#00856a', '#d13c57', '#be7000'];
        const names = ['Alex', 'Sam', 'Robin', 'Jules', 'Casey'];
        const peers = [...this.connections.values()].map(c => c.peer);
        const usedColors = new Set(peers.map(p => p.color));
        const usedNames = new Set(peers.map(p => p.name));
        let slot = 0, name: string, color: string;
        do {
            name = names[slot] ?? 'Guest ' + (slot + 1);
            color = palette[slot] ?? '#' + (Math.imul(slot + 1, 0x5b7e31) & 0xffffff).toString(16).padStart(6, '0');
            slot++;
        } while (usedColors.has(color) || usedNames.has(name));
        const peer: Peer = { id: crypto.randomUUID(), name, color, cursor: null, selection: [], viewport: { x: 0, y: 0, zoom: 1 } };
        const joinedEpoch = this.features.epoch;
        const connection: Connection = { peer, role, receiptKey, joinedEpoch, target: url.pathname.split('/')[2] };
        this.state.acceptWebSocket(ws);
        const saved = this.saveConnection(ws, connection);
        if (saved) await saved;
        this.send(ws, { type: 'init', role, name: this.name, ackSeq, nodes: [...this.doc.values()], styles: this.features.styles, comments: this.features.comments, versions: this.features.versions, peers, you: peer, epoch: joinedEpoch });
        this.connections.set(ws, connection);
        this.broadcast({ type: 'presence', peer }, ws);
        return new Response(null, { status: 101, webSocket: client });
    }
    webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
        return this.state.blockConcurrencyWhile(async () => { try {
            const connection = this.connections.get(ws);
            if (!connection) return;
            const { peer, role, receiptKey, joinedEpoch, target } = connection;
            const msg = JSON.parse(String(message)) as ClientMsg;
            if (role === 'view' && !['ping', 'presence', 'comment-add', 'version-preview'].includes(msg.type)) {
                this.send(ws, { type: 'error', request: msg.type, message: 'View only' }); return;
            }
            if (msg.type === 'share-view') {
                let key = await this.state.storage.get<string>('viewKey');
                if (!key) { key = crypto.randomUUID(); await this.state.storage.put('viewKey', key); }
                const registered = await this.env.ROOM.get(this.env.ROOM.idFromName('v:' + key)).fetch(new Request('https://room/_internal/register-view', { method: 'POST', body: target }));
                if (!registered.ok) throw Error('Alias registration failed');
                this.send(ws, { type: 'share-view', key }); return;
            }
            if (msg.type === 'ops' && Array.isArray(msg.ops) && msg.ops.length <= MAX_OPS) {
                if ((msg.epoch ?? joinedEpoch) !== this.features.epoch) {
                    this.send(ws, { type: 'ack', seq: msg.seq });
                    return;
                }
                const ackSeq = receiptKey ? await this.state.storage.get<number>(receiptKey) ?? 0 : 0;
                if (receiptKey && msg.seq <= ackSeq) {
                    const text = msg.ops.flatMap(op => this.canonicalText(op));
                    this.send(ws, { type: 'ack', seq: msg.seq, ...(text.length ? { text } : {}) });
                    return;
                }
                const ops: Op[] = [], text: Op[] = [];
                const deletingPage = msg.ops.some(op => op.t === 'delete' && this.doc.get(op.id)?.type === 'page');
                for (const op of msg.ops) {
                    applyOp(this.doc, op);
                    if (op?.t === 'set' && op.key === 'text' && op.baseText !== undefined) {
                        const merged = this.canonicalText(op);
                        ops.push(...merged); text.push(...merged);
                    } else ops.push(op);
                }
                const resolved = resolveStyleOps(this.doc, this.features.styles, msg.ops);
                for (const op of resolved) applyOp(this.doc, op);
                if (this.doc.needsLayout) applyLayout(this.doc);
                await this.doc.persist(this.state.storage, receiptKey ? { [receiptKey]: msg.seq } : {});
                this.broadcast({ type: 'ops', ops, from: peer.id }, ws);
                this.send(ws, { type: 'ack', seq: msg.seq, ...(text.length ? { text } : {}) });
                if (deletingPage) this.broadcast({ type: 'pages-state', nodes: [...this.doc.values()] });
                if (resolved.length) this.broadcast({ type: 'ops', ops: resolved, from: peer.id });
                if (msg.ops.length) await this.features.changed(peer.name);
            }
            else if (msg.type === 'rename') {
                if (typeof msg.name !== 'string') throw new Error('Invalid name');
                const name = sanitizeFileName(msg.name);
                await this.state.storage.put('file-name', name);
                this.name = name;
                this.broadcast({ type: 'name', name });
            }
            else if (msg.type === 'ping') this.send(ws, { type: 'pong' });
            else if (msg.type === 'presence' && Array.isArray(msg.selection) && msg.viewport) {
                const selectionChanged = connection.overflow && (peer.selection.length !== msg.selection.length || peer.selection.some((id, i) => id !== msg.selection[i]));
                peer.page = typeof msg.page === 'string' ? msg.page : undefined;
                peer.cursor = msg.cursor;
                peer.selection = msg.selection;
                peer.viewport = msg.viewport;
                peer.name = String(msg.name || peer.name).slice(0, 32);
                const spotlight = typeof msg.spotlight === 'boolean' && !!peer.spotlight !== msg.spotlight;
                if (spotlight) {
                    if (msg.spotlight) {
                        for (const [otherSocket, other] of this.connections) {
                            if (!other.peer.spotlight) continue;
                            other.peer.spotlight = false;
                            await this.saveConnection(otherSocket, other);
                            this.broadcast({ type: 'presence', peer: other.peer });
                        }
                    }
                    peer.spotlight = msg.spotlight;
                }
                await this.saveConnection(ws, connection, selectionChanged);
                this.broadcast({ type: 'presence', peer }, spotlight ? undefined : ws);
            }
            else if (msg.type !== 'ops' && msg.type !== 'presence') await this.features.message(msg, peer, m => this.send(ws, m));
        }
        catch {
            ws.close(1003, 'Invalid message');
        } });
    }
    private async leave(ws: WebSocket) {
        if (this.departed.has(ws)) return;
        const connection = this.connections.get(ws) ?? this.attachment(ws);
        if (!connection) return;
        this.departed.add(ws);
        this.connections.delete(ws);
        const id = connection.peer.id;
        this.broadcast({ type: 'leave', id });
        if (connection.overflow) await this.state.storage.delete('socket:' + id);
    }
    webSocketClose(ws: WebSocket, code: number, reason: string) {
        const left = this.leave(ws);
        if (code !== 1006) {
            if (code >= 1000 && code < 5000 && ![1004, 1005, 1015].includes(code)) ws.close(code, reason);
            else ws.close();
        }
        return left;
    }
    webSocketError(ws: WebSocket) {
        const left = this.leave(ws);
        ws.close(1011, 'WebSocket error');
        return left;
    }
}
