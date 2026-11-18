import type { Point } from '../shared/geometry';
import type { Sync } from './sync';
import type { Viewport } from './viewport';
export class Presence extends EventTarget {
    cursor: Point | null = null;
    private timer = 0;
    private followingId?: string;
    private presenterId?: string;
    constructor(public sync: Sync, public viewport: Viewport, public selection: Set<string>) {
        super();
        sync.addEventListener('change', () => this.receive());
    }
    get following() { return this.followingId ? this.sync.peers.get(this.followingId) : undefined; }
    get presenter() { return this.presenterId ? this.sync.peers.get(this.presenterId) : undefined; }
    get presenting() { return this.sync.status === 'Live' && this.sync.you?.spotlight === true; }
    toggleFollow(id: string) {
        if (this.presenting) return;
        this.followingId = this.followingId === id || !this.sync.peers.has(id) ? undefined : id;
        this.applyFollow();
        this.dispatchEvent(new Event('change'));
    }
    stopFollowing() {
        if (!this.followingId) return false;
        this.followingId = undefined;
        this.dispatchEvent(new Event('change'));
        return true;
    }
    toggleSpotlight() {
        if (this.sync.status === 'Live') this.broadcast(!this.presenting);
    }
    update(cursor: Point | null = this.cursor) {
        this.cursor = cursor;
        if (this.timer) return;
        this.timer = window.setTimeout(() => {
            this.timer = 0;
            this.broadcast();
        }, 33);
    }
    private broadcast(spotlight?: boolean) {
        const you = this.sync.you;
        const { x, y, zoom } = this.viewport;
        if (you) this.sync.send({ type: 'presence', cursor: this.cursor, selection: [...this.selection], name: you.name, viewport: { x, y, zoom }, spotlight });
    }
    private receive() {
        const presenter = [...this.sync.peers.values()].find(peer => peer.spotlight);
        if (presenter?.id !== this.presenterId) {
            if (this.followingId === this.presenterId) this.followingId = undefined;
            this.presenterId = presenter?.id;
            if (presenter) this.followingId = presenter.id;
        }
        if (this.presenting || !this.following) this.followingId = undefined;
        this.applyFollow();
    }
    private applyFollow() {
        const remote = this.following?.viewport;
        if (remote) this.viewport.follow(remote);
    }
}
