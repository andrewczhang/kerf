import { children, nodeFills, type Node } from '../shared/doc';
import { paintStyle, rgba } from './paint';
import { bounds, handles, world, type Rect } from '../shared/geometry';
import type { Context } from './tools/tool';
import type { Sync } from './sync';
import { drawGradientHandles } from './gradient-handles';
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
        const snapshot = (source: HTMLCanvasElement) => { const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height; copy.getContext('2d')!.drawImage(source, 0, 0); return copy; };
        const drawNode = (n: Node, target = c, layered = false, backdrop?: HTMLCanvasElement) => {
            const r = world(store.doc, n), effects = (n.effects ?? []).filter(e => e.visible), scale = v.zoom * d, layer = effects.filter(e => e.type === 'layer-blur');
            if (layer.length && !layered) { const underneath = snapshot(target.canvas), buffer = snapshot(target.canvas), b = buffer.getContext('2d')!; b.clearRect(0, 0, buffer.width, buffer.height); b.setTransform(target.getTransform()); drawNode(n, b, true, underneath); target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.filter = layer.map(e => `blur(${e.type === 'layer-blur' ? e.radius * scale : 0}px)`).join(' '); target.drawImage(buffer, 0, 0); target.restore(); return; }
            const path = (spread = 0) => { const p = new Path2D(), w = Math.max(.001, r.w + 2 * spread), h = Math.max(.001, r.h + 2 * spread); if (n.type === 'ellipse') p.ellipse(r.x + r.w / 2, r.y + r.h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else p.roundRect(r.x - spread, r.y - spread, w, h, Math.max(0, Math.min(n.radius + spread, w / 2, h / 2))); return p; }, shape = path();
            target.save(); target.globalAlpha *= n.opacity;
            for (const e of effects) if (e.type === 'drop-shadow') { target.save(); const shift = (target.canvas.width + target.canvas.height) / scale + r.w + r.h + Math.abs(e.spread) * 2 + e.blur * 4; target.translate(-shift, 0); target.shadowColor = rgba(e.color, e.opacity); target.shadowBlur = e.blur * scale; target.shadowOffsetX = (shift + e.x) * scale; target.shadowOffsetY = e.y * scale; target.fillStyle = '#000'; target.fill(path(e.spread)); target.restore(); }
            for (const e of effects) if (e.type === 'background-blur') { const copy = backdrop ?? snapshot(target.canvas); target.save(); target.clip(shape); target.setTransform(1, 0, 0, 1, 0, 0); target.filter = `blur(${e.radius * scale}px)`; target.drawImage(copy, 0, 0); target.restore(); }
            for (const paint of nodeFills(n)) if (paint.visible) { target.save(); target.globalAlpha *= paint.opacity; let fillShape = shape; if (paint.type === 'linear' || paint.type === 'radial') { target.translate(r.x, r.y); target.scale(r.w, r.h); fillShape = new Path2D(); fillShape.addPath(shape, new DOMMatrix([1 / r.w, 0, 0, 1 / r.h, -r.x / r.w, -r.y / r.h])); } const style = paintStyle(target, paint, r, location.pathname.split('/')[2] || 'untitled', this.invalidate); if (style) { target.fillStyle = style; target.fill(fillShape); } target.restore(); }
            if (n.stroke) { target.lineWidth = n.strokeWidth; target.strokeStyle = n.stroke; target.stroke(shape); }
            for (const e of effects) if (e.type === 'inner-shadow') { target.save(); target.clip(shape); const ring = new Path2D(); const margin = Math.max(r.w, r.h) + e.blur * 4 + Math.abs(e.spread) + Math.abs(e.x) + Math.abs(e.y), shift = (target.canvas.width + target.canvas.height) / scale + margin * 4; ring.rect(r.x - margin, r.y - margin, r.w + margin * 2, r.h + margin * 2); ring.addPath(path(-e.spread)); target.fillStyle = '#000'; target.shadowColor = rgba(e.color, e.opacity); target.shadowBlur = e.blur * scale; target.shadowOffsetX = (shift + e.x) * scale; target.shadowOffsetY = e.y * scale; target.translate(-shift, 0); target.fill(ring, 'evenodd'); target.restore(); }
            if (n.type === 'frame') { target.clip(shape); for (const child of children(store.doc, n.id)) drawNode(child, target); }
            target.restore(); if (n.type === 'frame') { target.fillStyle = '#77766f'; target.font = `${11 / v.zoom}px system-ui`; target.fillText(n.name, r.x, r.y - 8 / v.zoom); }
        };
        for (const n of children(store.doc, null))
            drawNode(n);
        const outline = (r: Rect, color: string, dash = false) => { c.strokeStyle = color; c.lineWidth = 1 / v.zoom; c.setLineDash(dash ? [4 / v.zoom, 3 / v.zoom] : []); c.strokeRect(r.x, r.y, r.w, r.h); c.setLineDash([]); };
        const selected = [...store.selection].map(id => store.doc.get(id)).filter((n): n is Node => !!n);
        if (this.app.hover && !store.selection.has(this.app.hover)) {
            const n = store.doc.get(this.app.hover);
            if (n)
                outline(world(store.doc, n), '#ff4f00');
        }
        if (selected.length) {
            for (const n of selected)
                outline(world(store.doc, n), '#ff4f00');
            const box = bounds(selected.map(n => world(store.doc, n)));
            outline(box, '#ff4f00');
            for (const p of handles(box)) {
                c.fillStyle = '#fbfbf9';
                c.fillRect(p.x - 3 / v.zoom, p.y - 3 / v.zoom, 6 / v.zoom, 6 / v.zoom);
                outline({ x: p.x - 3 / v.zoom, y: p.y - 3 / v.zoom, w: 6 / v.zoom, h: 6 / v.zoom }, '#ff4f00');
            }
        }
        drawGradientHandles(c, this.app);
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
