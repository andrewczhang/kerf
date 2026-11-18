import type { ServerMsg, ClientMsg, Peer } from '../shared/protocol';
import type { Store } from './store';
import type { Comment } from '../shared/comments';
import type { Version } from '../shared/versions';
import { applyOp } from '../shared/doc';
export class Sync extends EventTarget {
    socket?: WebSocket;
    peers = new Map<string, Peer>();
    you?: Peer;
    status = 'Connecting';
    retry = 500;
    comments: Comment[] = [];
    versions: Version[] = [];
    constructor(public store: Store, public file: string) { super(); store.send = (ops, seq) => this.send({ type: 'ops', ops, seq }); this.connect(); }
    notify() { this.dispatchEvent(new Event('change')); }
    send(msg: ClientMsg): boolean {
        if (this.socket?.readyState !== WebSocket.OPEN) return false;
        this.socket.send(JSON.stringify(msg));
        return true;
    }
    connect() { const ws = this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/f/${this.file}/ws`); ws.onmessage = e => { const m = JSON.parse(e.data) as ServerMsg; if (m.type === 'init') {
        this.you = m.you;
        this.comments = m.comments;
        this.versions = m.versions;
        this.peers = new Map(m.peers.map(p => [p.id, p]));
        this.store.init(m.nodes);
        this.status = 'Live';
        this.retry = 500;
        for (const [seq, ops] of this.store.pending)
            this.send({ type: 'ops', seq, ops });
    }
    else if (m.type === 'comments') { this.comments = m.comments; this.dispatchEvent(new Event('comments-change')); }
    else if (m.type === 'versions') { this.versions = m.versions; this.dispatchEvent(new Event('versions-change')); }
    else if (m.type === 'version-preview') this.dispatchEvent(new CustomEvent('preview', { detail: m }));
    else if (m.type === 'restored') {
        this.store.undoStack = []; this.store.redoStack = []; this.store.group = null;
        for (const op of m.ops) applyOp(this.store.doc, op);
        for (const ops of this.store.pending.values())
            for (const op of ops) applyOp(this.store.doc, op);
        this.store.changed(); this.dispatchEvent(new Event('restored'));
    }
    else if (m.type === 'ack')
        this.store.pending.delete(m.seq);
    else if (m.type === 'ops')
        this.store.remote(m.ops);
    else if (m.type === 'presence') {
        if (m.peer.id === this.you?.id)
            this.you = m.peer;
        else
            this.peers.set(m.peer.id, m.peer);
    }
    else
        this.peers.delete(m.id); this.notify(); }; ws.onclose = () => { this.status = 'Reconnecting'; this.peers.clear(); this.notify(); setTimeout(() => this.connect(), this.retry); this.retry = Math.min(10000, this.retry * 1.7); }; ws.onerror = () => ws.close(); }
}
