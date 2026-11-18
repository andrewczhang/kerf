import { children, nodeFills, isTextNode, type Doc, type Node } from '../shared/doc';
import { world } from './geometry';
import { font, measureTextNode } from './text-layout';
import { paintStyle, rgba } from './paint';
import { toAbs, trace } from '../shared/path';
import { maskedText, textMask, textShape } from './text-paint';

type DrawOptions = { zoom: number; labels: boolean; skip?: string; scale?: number; file?: string; invalidate?: () => void };
export function drawNode(c: CanvasRenderingContext2D, doc: Doc, n: Node, opts: DrawOptions) {
    if (opts.skip === n.id) return;
    if (n.fills !== undefined || n.effects !== undefined) { drawPaintedNode(c, doc, n, opts); return; }
    const r = world(doc, n);
    c.save();
    c.globalAlpha *= n.opacity;
    if (isTextNode(n)) {
        const { lines, leading, baseline, offset } = measureTextNode(n);
        c.fillStyle = n.fill;
        c.font = font(n);
        c.textAlign = n.textAlign;
        lines.forEach((line, i) => c.fillText(line, r.x + offset, r.y + baseline + i * leading));
        c.restore();
        return;
    }
    c.beginPath();
    if (n.type === 'path') {
        trace(c, toAbs(n.points ?? [], r), !!n.closed);
        if (n.closed) {
            c.fillStyle = n.fill;
            c.fill();
        }
        if (n.stroke && n.strokeWidth > 0) {
            c.lineWidth = n.strokeWidth;
            c.lineJoin = c.lineCap = 'round';
            c.strokeStyle = n.stroke;
            c.stroke();
        }
        c.restore();
        return;
    }
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
    const path = (spread = 0) => { const p = new Path2D(), w = Math.max(.001, r.w + 2 * spread), h = Math.max(.001, r.h + 2 * spread); if (n.type === 'path') { const original = new Path2D(); trace(original, toAbs(n.points ?? [], r), !!n.closed); if (spread) p.addPath(original, new DOMMatrix([w / r.w, 0, 0, h / r.h, r.x - spread - r.x * w / r.w, r.y - spread - r.y * h / r.h])); else return original; } else if (n.type === 'ellipse') p.ellipse(r.x + r.w / 2, r.y + r.h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else p.roundRect(r.x - spread, r.y - spread, w, h, Math.max(0, Math.min(n.radius + spread, w / 2, h / 2))); return p; }, shape = path();
    target.save(); target.globalAlpha *= n.opacity;
    if (n.type === 'path') target.lineJoin = target.lineCap = 'round';
    const text = isTextNode(n) ? n : undefined, mask = text && effects.some(e => e.type === 'background-blur' || e.type === 'inner-shadow') ? textMask(target, text, r) : undefined;
    const clipShape = (draw: (c: CanvasRenderingContext2D) => void) => { if (mask) maskedText(target, mask, draw); else { target.save(); target.clip(shape); draw(target); target.restore(); } };
    const hasFill = (n.type !== 'path' || !!n.closed) && nodeFills(n).some(p => p.visible && p.opacity > 0 && (p.type !== 'linear' && p.type !== 'radial' || p.stops.some(s => s.opacity > 0))), hasStroke = !!n.stroke && n.strokeWidth > 0;
    for (const e of effects) if (e.type === 'drop-shadow' && (hasFill || hasStroke)) { target.save(); const shift = (target.canvas.width + target.canvas.height) / scale + r.w + r.h + Math.abs(e.spread) * 2 + e.blur * 4; target.translate(-shift, 0); target.shadowColor = rgba(e.color, e.opacity); target.shadowBlur = e.blur * scale; target.shadowOffsetX = (shift + e.x) * scale; target.shadowOffsetY = e.y * scale; target.fillStyle = '#000'; if (text) { target.translate(shift, 0); const glyphs = textMask(target, text, r, e.spread, !hasFill); target.shadowOffsetX = (shift + e.x) * scale; target.setTransform(1, 0, 0, 1, 0, 0); target.drawImage(glyphs, -shift * scale, 0); } else if (hasFill) target.fill(path(e.spread)); else { const width = n.strokeWidth + e.spread * 2; if (width > 0) { target.strokeStyle = '#000'; target.lineWidth = width; target.stroke(shape); } } target.restore(); }
    for (const e of effects) if (e.type === 'background-blur') { const copy = backdrop ?? snapshot(target.canvas); clipShape(c => { c.setTransform(1, 0, 0, 1, 0, 0); c.filter = `blur(${e.radius * scale}px)`; c.drawImage(copy, 0, 0); }); }
    for (const paint of nodeFills(n)) if (paint.visible && (n.type !== 'path' || n.closed)) { target.save(); target.globalAlpha *= paint.opacity; let fillShape = shape; if (paint.type === 'radial') { target.translate(r.x, r.y); target.scale(r.w, r.h); fillShape = new Path2D(); fillShape.addPath(shape, new DOMMatrix([1 / r.w, 0, 0, 1 / r.h, -r.x / r.w, -r.y / r.h])); } const style = paintStyle(target, paint, r, opts.file ?? location.pathname.split('/')[2] ?? 'untitled', opts.invalidate ?? (() => {})); if (style) { target.fillStyle = style; if (text) { if (paint.type === 'radial') { target.scale(1 / r.w, 1 / r.h); target.translate(-r.x, -r.y); } textShape(target, text, r); } else target.fill(fillShape); } target.restore(); }
    if (n.stroke && n.strokeWidth > 0) { target.lineWidth = n.strokeWidth; target.strokeStyle = n.stroke; if (text) textShape(target, text, r, true); else target.stroke(shape); }
    for (const e of effects) if (e.type === 'inner-shadow') { if (text && mask) { clipShape(c => { const inverse = snapshot(e.spread ? textMask(target, text, r, -e.spread) : mask), b = inverse.getContext('2d')!; b.globalCompositeOperation = 'source-out'; b.fillStyle = '#000'; b.fillRect(0, 0, inverse.width, inverse.height); const shift = inverse.width + inverse.height + e.blur * scale * 4; c.setTransform(1, 0, 0, 1, 0, 0); c.shadowColor = rgba(e.color, e.opacity); c.shadowBlur = e.blur * scale; c.shadowOffsetX = shift + e.x * scale; c.shadowOffsetY = e.y * scale; c.drawImage(inverse, -shift, 0); }); continue; } target.save(); target.clip(shape); const ring = new Path2D(); const margin = Math.max(r.w, r.h) + e.blur * 4 + Math.abs(e.spread) + Math.abs(e.x) + Math.abs(e.y), shift = (target.canvas.width + target.canvas.height) / scale + margin * 4; ring.rect(r.x - margin, r.y - margin, r.w + margin * 2, r.h + margin * 2); ring.addPath(path(-e.spread)); target.fillStyle = '#000'; target.shadowColor = rgba(e.color, e.opacity); target.shadowBlur = e.blur * scale; target.shadowOffsetX = (shift + e.x) * scale; target.shadowOffsetY = e.y * scale; target.translate(-shift, 0); target.fill(ring, 'evenodd'); target.restore(); }
    if (n.type === 'frame') { target.clip(shape); for (const child of children(doc, n.id)) drawNode(target, doc, child, opts); }
    target.restore(); if (n.type === 'frame' && opts.labels) { target.fillStyle = '#77766f'; target.font = `${11 / opts.zoom}px system-ui`; target.fillText(n.name, r.x, r.y - 8 / opts.zoom); }
}
