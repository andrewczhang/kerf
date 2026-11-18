import type { WebSocket, DurableObjectState, Request } from '@cloudflare/workers-types';
import { applyOp, type Doc, type Node } from '../src/shared/doc';
import type { ClientMsg, Peer, ServerMsg } from '../src/shared/protocol';
declare const WebSocketPair: typeof import('@cloudflare/workers-types').WebSocketPair;
declare const Response: typeof import('@cloudflare/workers-types').Response;
export class Room {
    doc: Doc = new Map();
    peers = new Map<WebSocket, Peer>();
    constructor(private state: DurableObjectState) { state.blockConcurrencyWhile(async () => { const nodes = await state.storage.get<Node[]>('nodes'); this.doc = new Map((nodes ?? []).map(n => [n.id, n])); }); }
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
        if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
            return new Response('WebSocket required', { status: 426 });
        const pair = new WebSocketPair();
        const [client, ws] = Object.values(pair);
        ws.accept();
        const palette = ['#2364df', '#a02bbe', '#00856a', '#d13c57', '#be7000'];
        const peer: Peer = { id: crypto.randomUUID(), name: ['Alex', 'Sam', 'Robin', 'Jules', 'Casey'][this.peers.size % 5], color: palette[this.peers.size % 5], cursor: null, selection: [], viewport: { x: 0, y: 0, zoom: 1 } };
        this.send(ws, { type: 'init', nodes: [...this.doc.values()], peers: [...this.peers.values()], you: peer });
        this.peers.set(ws, peer);
        this.broadcast({ type: 'presence', peer }, ws);
        ws.addEventListener('message', event => { this.state.blockConcurrencyWhile(async () => { try {
            const msg = JSON.parse(String(event.data)) as ClientMsg;
            if (msg.type === 'ops' && Array.isArray(msg.ops) && msg.ops.length <= 1000) {
                for (const op of msg.ops)
                    applyOp(this.doc, op);
                await this.state.storage.put('nodes', [...this.doc.values()]);
                this.broadcast({ type: 'ops', ops: msg.ops, from: peer.id }, ws);
                this.send(ws, { type: 'ack', seq: msg.seq });
            }
            else if (msg.type === 'presence' && Array.isArray(msg.selection) && msg.viewport) {
                peer.cursor = msg.cursor;
                peer.selection = msg.selection;
                peer.viewport = msg.viewport;
                peer.name = String(msg.name || peer.name).slice(0, 32);
                this.broadcast({ type: 'presence', peer }, ws);
            }
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
