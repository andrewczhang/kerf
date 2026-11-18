import type { ServerMsg, ClientMsg, Peer } from '../shared/protocol';
import type { Store } from './store';
export class Sync extends EventTarget {
    socket?: WebSocket;
    peers = new Map<string, Peer>();
    you?: Peer;
    status = 'Connecting';
    retry = 500;
    constructor(public store: Store, public file: string) { super(); store.send = (ops, seq) => this.send({ type: 'ops', ops, seq }); this.connect(); }
    notify() { this.dispatchEvent(new Event('change')); }
    send(msg: ClientMsg) { if (this.socket?.readyState === WebSocket.OPEN)
        this.socket.send(JSON.stringify(msg)); }
    connect() { const ws = this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/f/${this.file}/ws`); ws.onmessage = e => { const m = JSON.parse(e.data) as ServerMsg; if (m.type === 'init') {
        this.you = m.you;
        this.peers = new Map(m.peers.map(p => [p.id, p]));
        this.store.init(m.nodes);
        this.status = 'Live';
        this.retry = 500;
        for (const [seq, ops] of this.store.pending)
            this.send({ type: 'ops', seq, ops });
    }
    else if (m.type === 'ack')
        this.store.pending.delete(m.seq);
    else if (m.type === 'ops')
        this.store.remote(m.ops);
    else if (m.type === 'presence')
        this.peers.set(m.peer.id, m.peer);
    else
        this.peers.delete(m.id); this.notify(); }; ws.onclose = () => { this.status = 'Reconnecting'; this.peers.clear(); this.notify(); setTimeout(() => this.connect(), this.retry); this.retry = Math.min(10000, this.retry * 1.7); }; ws.onerror = () => ws.close(); }
}
