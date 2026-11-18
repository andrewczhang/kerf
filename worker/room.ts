import type { WebSocket, DurableObjectState, Request } from '@cloudflare/workers-types';
import { applyOp, isTextNode, normalizeNode, type Doc, type Node, type Op } from '../src/shared/doc';
import { applyLayout } from '../src/shared/layout';
import type { ClientMsg, Peer, ServerMsg } from '../src/shared/protocol';
import { MAX_OPS } from '../src/shared/protocol';
import { Features } from './features';
import { resolveStyleOps } from '../src/shared/styles';
import { sanitizeFileName } from '../src/shared/file-name';
declare const WebSocketPair: typeof import('@cloudflare/workers-types').WebSocketPair;
declare const Response: typeof import('@cloudflare/workers-types').Response;
export class Room {
    doc: Doc = new Map();
    name = '';
    peers = new Map<WebSocket, Peer>();
    features: Features;
    constructor(private state: DurableObjectState) { this.features = new Features(state.storage, this.doc, m => this.broadcast(m)); state.blockConcurrencyWhile(async () => { this.name = await state.storage.get<string>('file-name') ?? ''; const nodes = await state.storage.get<Node[]>('nodes'); for (const n of nodes ?? []) this.doc.set(n.id, normalizeNode(n)); await this.features.load(); }); }
    send(ws: WebSocket, msg: ServerMsg) { try {
        ws.send(JSON.stringify(msg));
    }
    catch {
        this.peers.delete(ws);
    } }
    broadcast(msg: ServerMsg, except?: WebSocket) { for (const ws of this.peers.keys())
        if (ws !== except)
            this.send(ws, msg); }
    async fetch(req: Request) {
        const asset = new URL(req.url).pathname.match(/\/assets\/([^/]+)$/);
        if (asset) {
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
        ws.accept();
        const clientId = new URL(req.url).searchParams.get('clientId');
        const receiptKey = clientId ? 'receipt:' + clientId : undefined;
        let ackSeq = receiptKey ? await this.state.storage.get<number>(receiptKey) ?? 0 : 0;
        const palette = ['#2364df', '#a02bbe', '#00856a', '#d13c57', '#be7000'];
        const names = ['Alex', 'Sam', 'Robin', 'Jules', 'Casey'];
        const usedColors = new Set([...this.peers.values()].map(p => p.color));
        const usedNames = new Set([...this.peers.values()].map(p => p.name));
        let slot = 0, name: string, color: string;
        do {
            name = names[slot] ?? 'Guest ' + (slot + 1);
            color = palette[slot] ?? '#' + (Math.imul(slot + 1, 0x5b7e31) & 0xffffff).toString(16).padStart(6, '0');
            slot++;
        } while (usedColors.has(color) || usedNames.has(name));
        const peer: Peer = { id: crypto.randomUUID(), name, color, cursor: null, selection: [], viewport: { x: 0, y: 0, zoom: 1 } };
        const joinedEpoch = this.features.epoch;
        this.send(ws, { type: 'init', name: this.name, ackSeq, nodes: [...this.doc.values()], styles: this.features.styles, comments: this.features.comments, versions: this.features.versions, peers: [...this.peers.values()], you: peer, epoch: joinedEpoch });
        this.peers.set(ws, peer);
        this.broadcast({ type: 'presence', peer }, ws);
        ws.addEventListener('message', event => { this.state.blockConcurrencyWhile(async () => { try {
            const msg = JSON.parse(String(event.data)) as ClientMsg;
            if (msg.type === 'ops' && Array.isArray(msg.ops) && msg.ops.length <= MAX_OPS) {
                if ((msg.epoch ?? joinedEpoch) !== this.features.epoch) {
                    this.send(ws, { type: 'ack', seq: msg.seq });
                    return;
                }
                if (receiptKey) ackSeq = await this.state.storage.get<number>(receiptKey) ?? 0;
                if (receiptKey && msg.seq <= ackSeq) { this.send(ws, { type: 'ack', seq: msg.seq }); return; }
                const ops: Op[] = [], text: Op[] = [];
                for (const op of msg.ops) {
                    applyOp(this.doc, op);
                    if (op?.t === 'set' && op.key === 'text' && op.baseText !== undefined) {
                        const n = this.doc.get(op.id);
                        if (isTextNode(n)) {
                            const merged = { t: 'set', id: op.id, key: 'text', value: n.text } as const;
                            ops.push(merged); text.push(merged);
                        }
                    } else ops.push(op);
                }
                const resolved = resolveStyleOps(this.doc, this.features.styles, msg.ops);
                for (const op of resolved) applyOp(this.doc, op);
                applyLayout(this.doc);
                await this.state.storage.put({ nodes: [...this.doc.values()], ...(receiptKey ? { [receiptKey]: msg.seq } : {}) });
                this.broadcast({ type: 'ops', ops, from: peer.id }, ws);
                this.send(ws, { type: 'ack', seq: msg.seq, ...(text.length ? { text } : {}) });
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
                peer.cursor = msg.cursor;
                peer.selection = msg.selection;
                peer.viewport = msg.viewport;
                peer.name = String(msg.name || peer.name).slice(0, 32);
                const spotlight = typeof msg.spotlight === 'boolean' && !!peer.spotlight !== msg.spotlight;
                if (spotlight) {
                    if (msg.spotlight) {
                        for (const other of this.peers.values()) {
                            if (!other.spotlight) continue;
                            other.spotlight = false;
                            this.broadcast({ type: 'presence', peer: other });
                        }
                    }
                    peer.spotlight = msg.spotlight;
                }
                this.broadcast({ type: 'presence', peer }, spotlight ? undefined : ws);
            }
            else if (msg.type !== 'ops' && msg.type !== 'presence') await this.features.message(msg, peer, m => this.send(ws, m));
        }
        catch {
            ws.close(1003, 'Invalid message');
        } }); });
        const leave = () => { if (this.peers.delete(ws))
            this.broadcast({ type: 'leave', id: peer.id }); };
        ws.addEventListener('close', leave);
        ws.addEventListener('error', leave);
        return new Response(null, { status: 101, webSocket: client });
    }
}
