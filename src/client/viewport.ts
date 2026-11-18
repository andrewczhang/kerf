import type { Point } from '../shared/geometry';
export class Viewport {
    x = 120;
    y = 100;
    zoom = 1;
    constructor(public changed: () => void) { }
    screen(p: Point) { return { x: p.x * this.zoom + this.x, y: p.y * this.zoom + this.y }; }
    world(p: Point) { return { x: (p.x - this.x) / this.zoom, y: (p.y - this.y) / this.zoom }; }
    zoomAt(p: Point, factor: number) { const w = this.world(p); this.zoom = Math.max(.05, Math.min(16, this.zoom * factor)); this.x = p.x - w.x * this.zoom; this.y = p.y - w.y * this.zoom; this.changed(); }
}
