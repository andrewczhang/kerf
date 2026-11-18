import { children, nodeFills, type Doc, type Node } from '../shared/doc';
import { world } from '../shared/geometry';
import { paintStyle, rgba } from './paint';

type DrawOptions = { zoom: number; labels: boolean; scale?: number; file?: string; invalidate?: () => void };
export function drawNode(c: CanvasRenderingContext2D, doc: Doc, n: Node, opts: DrawOptions) {
    if (n.fills !== undefined || n.effects !== undefined) { drawPaintedNode(c, doc, n, opts); return; }
    const r = world(doc, n);
    c.save();
    c.globalAlpha *= n.opacity;
    c.beginPath();
    if (n.type === 'ellipse')
        c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else
        c.roundRect(r.x, r.y, r.w, r.h, Math.min(n.radius, r.w / 2, r.h / 2));
    c.fillStyle = n.fill;
    c.fill();
    if (n.stroke && n.strokeWidth > 0) {
        c.lineWidth = n.strokeWidth;
        c.strokeStyle = n.stroke;
        c.stroke();
    }
    if (n.type === 'frame') {
        c.clip();
        for (const child of children(doc, n.id))
            drawNode(c, doc, child, opts);
    }
    c.restore();
    if (n.type === 'frame' && opts.labels) {
        c.fillStyle = '#77766f';
        c.font = `${11 / opts.zoom}px system-ui`;
        c.fillText(n.name, r.x, r.y - 8 / opts.zoom);
    }
}

const snapshot = (source: HTMLCanvasElement) => { const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height; copy.getContext('2d')!.drawImage(source, 0, 0); return copy; };
function drawPaintedNode(target: CanvasRenderingContext2D, doc: Doc, n: Node, opts: DrawOptions, layered = false, backdrop?: HTMLCanvasElement) {
    const r = world(doc, n), effects = (n.effects ?? []).filter(e => e.visible), scale = opts.scale ?? opts.zoom, layer = effects.filter(e => e.type === 'layer-blur');
    if (layer.length && !layered) { const underneath = snapshot(target.canvas), buffer = snapshot(target.canvas), b = buffer.getContext('2d')!; b.clearRect(0, 0, buffer.width, buffer.height); b.setTransform(target.getTransform()); drawPaintedNode(b, doc, n, opts, true, underneath); target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.filter = layer.map(e => `blur(${e.type === 'layer-blur' ? e.radius * scale : 0}px)`).join(' '); target.drawImage(buffer, 0, 0); target.restore(); return; }
    const path = (spread = 0) => { const p = new Path2D(), w = Math.max(.001, r.w + 2 * spread), h = Math.max(.001, r.h + 2 * spread); if (n.type === 'ellipse') p.ellipse(r.x + r.w / 2, r.y + r.h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else p.roundRect(r.x - spread, r.y - spread, w, h, Math.max(0, Math.min(n.radius + spread, w / 2, h / 2))); return p; }, shape = path();
    target.save(); target.globalAlpha *= n.opacity;
    for (const e of effects) if (e.type === 'drop-shadow') { target.save(); const shift = (target.canvas.width + target.canvas.height) / scale + r.w + r.h + Math.abs(e.spread) * 2 + e.blur * 4; target.translate(-shift, 0); target.shadowColor = rgba(e.color, e.opacity); target.shadowBlur = e.blur * scale; target.shadowOffsetX = (shift + e.x) * scale; target.shadowOffsetY = e.y * scale; target.fillStyle = '#000'; target.fill(path(e.spread)); target.restore(); }
    for (const e of effects) if (e.type === 'background-blur') { const copy = backdrop ?? snapshot(target.canvas); target.save(); target.clip(shape); target.setTransform(1, 0, 0, 1, 0, 0); target.filter = `blur(${e.radius * scale}px)`; target.drawImage(copy, 0, 0); target.restore(); }
    for (const paint of nodeFills(n)) if (paint.visible) { target.save(); target.globalAlpha *= paint.opacity; let fillShape = shape; if (paint.type === 'linear' || paint.type === 'radial') { target.translate(r.x, r.y); target.scale(r.w, r.h); fillShape = new Path2D(); fillShape.addPath(shape, new DOMMatrix([1 / r.w, 0, 0, 1 / r.h, -r.x / r.w, -r.y / r.h])); } const style = paintStyle(target, paint, r, opts.file ?? location.pathname.split('/')[2] ?? 'untitled', opts.invalidate ?? (() => {})); if (style) { target.fillStyle = style; target.fill(fillShape); } target.restore(); }
    if (n.stroke && n.strokeWidth > 0) { target.lineWidth = n.strokeWidth; target.strokeStyle = n.stroke; target.stroke(shape); }
    for (const e of effects) if (e.type === 'inner-shadow') { target.save(); target.clip(shape); const ring = new Path2D(); const margin = Math.max(r.w, r.h) + e.blur * 4 + Math.abs(e.spread) + Math.abs(e.x) + Math.abs(e.y), shift = (target.canvas.width + target.canvas.height) / scale + margin * 4; ring.rect(r.x - margin, r.y - margin, r.w + margin * 2, r.h + margin * 2); ring.addPath(path(-e.spread)); target.fillStyle = '#000'; target.shadowColor = rgba(e.color, e.opacity); target.shadowBlur = e.blur * scale; target.shadowOffsetX = (shift + e.x) * scale; target.shadowOffsetY = e.y * scale; target.translate(-shift, 0); target.fill(ring, 'evenodd'); target.restore(); }
    if (n.type === 'frame') { target.clip(shape); for (const child of children(doc, n.id)) drawNode(target, doc, child, opts); }
    target.restore(); if (n.type === 'frame' && opts.labels) { target.fillStyle = '#77766f'; target.font = `${11 / opts.zoom}px system-ui`; target.fillText(n.name, r.x, r.y - 8 / opts.zoom); }
}
