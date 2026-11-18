import { childIndex, type Node } from '../shared/doc';
import { expand, isVirtual } from '../shared/components';
import { bounds, handles, type Rect } from '../shared/geometry';
import { aabb, nodeHandles, worldCorners, worldMatrix } from './geometry';
import { transform } from '../shared/geometry';
import type { Context } from './tools/tool';
import type { Sync } from './sync';
import { isAutoLayout, layoutInsertions } from './autolayout';
import { drawGradientHandles } from './gradient-handles';
import { blocked } from '../shared/layers';
import { drawGuides, drawSnapGrid } from './guides';
import { drawChildren } from './draw';
import type { Doc } from '../shared/doc';
import { toAbs, trace } from '../shared/path';
import { drawLayoutGrids } from './layout-grids';
export class Renderer {
    dirty = true;
    ctx: CanvasRenderingContext2D;
    width = 0;
    height = 0;
    preview: Doc | null = null;
    showLinks = false;
    inspectOverlay?: (c: CanvasRenderingContext2D) => void;
    constructor(public canvas: HTMLCanvasElement, public app: Context, public sync: Sync) { this.ctx = canvas.getContext('2d')!; new ResizeObserver(() => this.resize()).observe(canvas); requestAnimationFrame(() => this.loop()); }
    invalidate = () => { this.dirty = true; };
    resize() { const r = this.canvas.getBoundingClientRect(), d = devicePixelRatio || 1; this.width = r.width; this.height = r.height; this.canvas.width = Math.round(r.width * d); this.canvas.height = Math.round(r.height * d); this.invalidate(); }
    loop() { if (this.dirty) {
        this.dirty = false;
        this.draw();
    } requestAnimationFrame(() => this.loop()); }
    draw() {
        const c = this.ctx, { viewport: v } = this.app, store = this.preview ? { ...this.app.store, doc: this.preview, selection: new Set<string>() } : this.app.store, d = devicePixelRatio || 1;
        const doc = expand(store.doc);
        const tree = childIndex(doc);
        c.setTransform(d, 0, 0, d, 0, 0);
        c.clearRect(0, 0, this.width, this.height);
        drawSnapGrid(c, this.app, this.width, this.height);
        c.fillStyle = '#d6d4ce';
        const spacing = 24 * v.zoom * 2 ** Math.max(0, Math.ceil(Math.log2(.5 / v.zoom)));
        for (let x = ((v.x % spacing) + spacing) % spacing; x < this.width; x += spacing)
            for (let y = ((v.y % spacing) + spacing) % spacing; y < this.height; y += spacing)
                c.fillRect(x, y, 1, 1);
        c.save();
        c.translate(v.x, v.y);
        c.scale(v.zoom, v.zoom);
        drawChildren(c, doc, null, { zoom: v.zoom, scale: v.zoom * d, labels: true, skip: this.app.editingText, invalidate: this.invalidate, tree });
        if (!this.preview && this.app.snap?.layoutGrids !== false) drawLayoutGrids(c, doc, v.zoom);
        for (const n of doc.values()) {
            if (!n.link || !(this.showLinks || store.selection.has(n.id))) continue;
            const target = doc.get(n.link);
            if (!target || target.type !== 'frame') continue;
            const a = aabb(doc, n), b = aabb(doc, target);
            const x = a.x + a.w, y = a.y + a.h / 2, tx = b.x, ty = b.y + b.h / 2;
            const bend = Math.max(60 / v.zoom, Math.abs(tx - x) / 2);
            c.strokeStyle = '#ff4f00'; c.lineWidth = 1.5 / v.zoom;
            c.beginPath(); c.moveTo(x, y); c.bezierCurveTo(x + bend, y, tx - bend, ty, tx, ty); c.stroke();
            c.beginPath(); c.moveTo(tx - 8 / v.zoom, ty - 5 / v.zoom); c.lineTo(tx, ty); c.lineTo(tx - 8 / v.zoom, ty + 5 / v.zoom); c.stroke();
        }
        const outline = (r: Rect, color: string, dash = false) => { c.strokeStyle = color; c.lineWidth = 1 / v.zoom; c.setLineDash(dash ? [4 / v.zoom, 3 / v.zoom] : []); c.strokeRect(r.x, r.y, r.w, r.h); c.setLineDash([]); };
        const nodeOutline = (n: Node, color: string, dash = false) => { const ps = worldCorners(doc, n); c.beginPath(); ps.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath(); c.strokeStyle = color; c.lineWidth = 1 / v.zoom; c.setLineDash(dash ? [4 / v.zoom, 3 / v.zoom] : []); c.stroke(); c.setLineDash([]); };
        const curve = (n: Node, color: string) => { if (n.type !== 'path')
            return; const m = worldMatrix(doc, n); c.beginPath(); trace(c, toAbs(n.points ?? [], { x: 0, y: 0, w: n.w, h: n.h }).map(p => { const a = transform(m, p), i = transform(m, { x: p.ix, y: p.iy }), o = transform(m, { x: p.ox, y: p.oy }); return { ...a, ix: i.x, iy: i.y, ox: o.x, oy: o.y }; }), !!n.closed); c.strokeStyle = color; c.lineWidth = 1 / v.zoom; c.stroke(); };
        const selected = [...store.selection].map(id => doc.get(id)).filter((n): n is Node => !!n && !blocked(doc, n, false));
        if (selected.length === 1 && isAutoLayout(selected[0])) {
            const n = selected[0];
            c.save(); c.transform(...worldMatrix(doc, n)); c.globalAlpha = .35;
            outline({ x: n.padLeft ?? 0, y: n.padTop ?? 0, w: Math.max(0, n.w - (n.padLeft ?? 0) - (n.padRight ?? 0)), h: Math.max(0, n.h - (n.padTop ?? 0) - (n.padBottom ?? 0)) }, '#ff4f00', true);
            c.restore();
        }
        if (this.app.hover && !store.selection.has(this.app.hover)) {
            const n = doc.get(this.app.hover);
            if (n && !blocked(doc, n, false) && n.id !== this.app.editingText)
                n.type === 'path' ? curve(n, '#ff4f00') : nodeOutline(n, '#ff4f00');
        }
        if (selected.length && !this.app.editingText && !this.app.active?.ownsSelection) {
            for (const n of selected) {
                nodeOutline(n, '#ff4f00');
                curve(n, '#ff4f00');
            }
            const box = bounds(selected.map(n => aabb(doc, n)));
            if (selected.length > 1) outline(box, '#ff4f00');
            for (const p of selected.every(n => !isVirtual(n.id) && n.type !== 'text') ? selected.length === 1 ? nodeHandles(doc, selected[0]) : handles(box) : []) {
                c.fillStyle = '#fbfbf9';
                c.fillRect(p.x - 3 / v.zoom, p.y - 3 / v.zoom, 6 / v.zoom, 6 / v.zoom);
                outline({ x: p.x - 3 / v.zoom, y: p.y - 3 / v.zoom, w: 6 / v.zoom, h: 6 / v.zoom }, '#ff4f00');
            }
        }
        const insertion = this.preview ? undefined : layoutInsertions.get(this.app.store);
        if (insertion) {
            c.strokeStyle = '#ff4f00'; c.lineWidth = 2 / v.zoom;
            c.beginPath(); c.moveTo(insertion.from.x, insertion.from.y); c.lineTo(insertion.to.x, insertion.to.y); c.stroke();
        }
        if (!this.preview) drawGradientHandles(c, this.app);
        this.app.active?.draw?.(c, v.zoom);
        if (this.app.marquee) {
            c.fillStyle = '#ff4f0012';
            const r = this.app.marquee;
            c.fillRect(r.x, r.y, r.w, r.h);
            outline(r, '#ff4f00');
        }
        for (const peer of this.sync.peers.values()) {
            for (const id of peer.selection) {
                const n = doc.get(id);
                if (n && !blocked(doc, n, false))
                    nodeOutline(n, peer.color, true);
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
        drawGuides(c, this.app, this.width, this.height);
        this.inspectOverlay?.(c);
    }
}
