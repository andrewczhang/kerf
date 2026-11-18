import { children, type Node } from '../shared/doc';
import { bounds, handles, world, type Rect } from '../shared/geometry';
import type { Context } from './tools/tool';
import type { Sync } from './sync';
import { drawNode } from './draw';
import { toAbs, trace } from '../shared/path';
export class Renderer {
    dirty = true;
    ctx: CanvasRenderingContext2D;
    width = 0;
    height = 0;
    constructor(public canvas: HTMLCanvasElement, public app: Context, public sync: Sync) { this.ctx = canvas.getContext('2d')!; new ResizeObserver(() => this.resize()).observe(canvas); requestAnimationFrame(() => this.loop()); }
    invalidate = () => { this.dirty = true; };
    resize() { const r = this.canvas.getBoundingClientRect(), d = devicePixelRatio || 1; this.width = r.width; this.height = r.height; this.canvas.width = Math.round(r.width * d); this.canvas.height = Math.round(r.height * d); this.invalidate(); }
    loop() { if (this.dirty) {
        this.dirty = false;
        this.draw();
    } requestAnimationFrame(() => this.loop()); }
    draw() {
        const c = this.ctx, { viewport: v, store } = this.app, d = devicePixelRatio || 1;
        c.setTransform(d, 0, 0, d, 0, 0);
        c.clearRect(0, 0, this.width, this.height);
        c.fillStyle = '#d6d4ce';
        const spacing = 24 * v.zoom * 2 ** Math.max(0, Math.ceil(Math.log2(.5 / v.zoom)));
        for (let x = ((v.x % spacing) + spacing) % spacing; x < this.width; x += spacing)
            for (let y = ((v.y % spacing) + spacing) % spacing; y < this.height; y += spacing)
                c.fillRect(x, y, 1, 1);
        c.save();
        c.translate(v.x, v.y);
        c.scale(v.zoom, v.zoom);
        for (const n of children(store.doc, null))
            drawNode(c, store.doc, n, { zoom: v.zoom, labels: true });
        const outline = (r: Rect, color: string, dash = false) => { c.strokeStyle = color; c.lineWidth = 1 / v.zoom; c.setLineDash(dash ? [4 / v.zoom, 3 / v.zoom] : []); c.strokeRect(r.x, r.y, r.w, r.h); c.setLineDash([]); };
        const curve = (n: Node, color: string) => { if (n.type !== 'path')
            return; c.beginPath(); trace(c, toAbs(n.points ?? [], world(store.doc, n)), !!n.closed); c.strokeStyle = color; c.lineWidth = 1 / v.zoom; c.stroke(); };
        const selected = [...store.selection].map(id => store.doc.get(id)).filter((n): n is Node => !!n);
        if (this.app.hover && !store.selection.has(this.app.hover)) {
            const n = store.doc.get(this.app.hover);
            if (n)
                n.type === 'path' ? curve(n, '#ff4f00') : outline(world(store.doc, n), '#ff4f00');
        }
        if (selected.length && !this.app.active?.ownsSelection) {
            for (const n of selected) {
                outline(world(store.doc, n), '#ff4f00');
                curve(n, '#ff4f00');
            }
            const box = bounds(selected.map(n => world(store.doc, n)));
            outline(box, '#ff4f00');
            for (const p of handles(box)) {
                c.fillStyle = '#fbfbf9';
                c.fillRect(p.x - 3 / v.zoom, p.y - 3 / v.zoom, 6 / v.zoom, 6 / v.zoom);
                outline({ x: p.x - 3 / v.zoom, y: p.y - 3 / v.zoom, w: 6 / v.zoom, h: 6 / v.zoom }, '#ff4f00');
            }
        }
        this.app.active?.draw?.(c, v.zoom);
        if (this.app.marquee) {
            c.fillStyle = '#ff4f0012';
            const r = this.app.marquee;
            c.fillRect(r.x, r.y, r.w, r.h);
            outline(r, '#ff4f00');
        }
        for (const peer of this.sync.peers.values()) {
            for (const id of peer.selection) {
                const n = store.doc.get(id);
                if (n)
                    outline(world(store.doc, n), peer.color, true);
            }
        }
        c.restore();
        for (const peer of this.sync.peers.values()) {
            if (!peer.cursor)
                continue;
            const p = v.screen(peer.cursor);
            c.save();
            c.translate(p.x, p.y);
            c.beginPath();
            c.moveTo(0, 0);
            c.lineTo(4, 17);
            c.lineTo(8, 11);
            c.lineTo(15, 9);
            c.closePath();
            c.fillStyle = peer.color;
            c.fill();
            c.strokeStyle = '#fff';
            c.lineWidth = 1.3;
            c.stroke();
            c.font = '11px system-ui';
            const w = c.measureText(peer.name).width;
            c.fillRect(12, 18, w + 14, 22);
            c.fillStyle = '#fff';
            c.fillText(peer.name, 19, 33);
            c.restore();
        }
    }
}
