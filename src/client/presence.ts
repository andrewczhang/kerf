import type { Point } from '../shared/geometry';
import type { Sync } from './sync';
import type { Viewport } from './viewport';
export class Presence {
    cursor: Point | null = null;
    timer = 0;
    constructor(public sync: Sync, public viewport: Viewport, public selection: Set<string>) { }
    update(cursor: Point | null = this.cursor) { this.cursor = cursor; if (this.timer)
        return; this.timer = window.setTimeout(() => { this.timer = 0; const you = this.sync.you; if (you)
        this.sync.send({ type: 'presence', cursor: this.cursor, selection: [...this.selection], name: you.name, viewport: { x: this.viewport.x, y: this.viewport.y, zoom: this.viewport.zoom } }); }, 33); }
}
