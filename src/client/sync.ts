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
    clientId: string = crypto.randomUUID();
    ready = false;
    lastMessage = Date.now();
    storageError = false;
    constructor(public store: Store, public file: string) {
        super();
        if (navigator.onLine === false) this.status = 'Offline';
        try {
            const sessionKey = 'kerf:client:' + file;
            this.clientId = sessionStorage.getItem(sessionKey) ?? this.clientId;
            sessionStorage.setItem(sessionKey, this.clientId);
            const saved = JSON.parse(localStorage.getItem(this.storageKey) ?? 'null');
            if (saved) {
                this.clientId = saved.clientId;
                store.seq = saved.seq;
                store.pending = new Map(saved.pending);
                store.init(saved.nodes);
            }
        } catch { this.storageError = true; }
        store.send = (ops, seq) => { this.persist(); if (this.ready) this.send({ type: 'ops', ops, seq }); };
        store.addEventListener('change', () => { this.persist(); if (this.storageError) this.notify(); });
        window.addEventListener('offline', () => this.disconnect());
        window.addEventListener('beforeunload', e => {
            if (store.pending.size) { this.persist(); e.preventDefault(); (e as BeforeUnloadEvent).returnValue = ''; }
        });
        window.addEventListener('online', () => { this.socket?.close(); });
        setInterval(() => {
            if (navigator.onLine === false || Date.now() - this.lastMessage > 30000) this.disconnect();
            else this.send({ type: 'ping' });
        }, 10000);
        this.connect();
    }
    get storageKey() { return 'kerf:offline:' + this.file + ':' + this.clientId; }
    persist() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify({ clientId: this.clientId, seq: this.store.seq, pending: [...this.store.pending], nodes: [...this.store.doc.values()] }));
            this.storageError = false;
        } catch { this.storageError = true; }
    }
    disconnect() {
        this.ready = false;
        this.status = navigator.onLine === false ? 'Offline' : 'Reconnecting';
        this.socket?.close();
        this.notify();
    }
    notify() { if (this.storageError) this.status = 'Local storage unavailable — keep this tab open'; this.dispatchEvent(new Event('change')); }
    send(msg: ClientMsg): boolean {
        if (this.socket?.readyState !== WebSocket.OPEN) return false;
        this.socket.send(JSON.stringify(msg));
        return true;
    }
    connect() { this.lastMessage = Date.now(); const ws = this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/f/${this.file}/ws?clientId=${encodeURIComponent(this.clientId)}`); ws.onmessage = e => { if (ws !== this.socket) return; this.lastMessage = Date.now(); const m = JSON.parse(e.data) as ServerMsg; if (m.type === 'pong') return; if (m.type === 'init') {
        this.you = m.you;
        this.comments = m.comments;
        this.versions = m.versions;
        this.peers = new Map(m.peers.map(p => [p.id, p]));
        for (const seq of this.store.pending.keys()) if (seq <= (m.ackSeq ?? 0)) this.store.pending.delete(seq);
        this.store.init(m.nodes);
        this.ready = true;
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
    else if (m.type === 'ack') {
        this.store.pending.delete(m.seq); this.persist();
    }
    else if (m.type === 'ops')
        this.store.remote(m.ops);
    else if (m.type === 'presence') {
        if (m.peer.id === this.you?.id)
            this.you = m.peer;
        else
            this.peers.set(m.peer.id, m.peer);
    }
    else
        this.peers.delete(m.id); this.notify(); }; ws.onclose = () => { if (ws !== this.socket) return; this.ready = false; this.status = navigator.onLine === false ? 'Offline' : 'Reconnecting'; this.peers.clear(); this.notify(); setTimeout(() => this.connect(), this.retry); this.retry = Math.min(10000, this.retry * 1.7); }; ws.onerror = () => ws.close(); }
}
