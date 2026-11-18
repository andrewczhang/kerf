import { children, nodeFills, isTextNode, type Doc, type Effect, type Node } from '../shared/doc';
import { world } from './geometry';
import { font, measureTextNode, textPaintBounds } from './text-layout';
import { paintStyle, rgba } from './paint';
import { contoursAbs, toAbs, trace, type PathPoint } from '../shared/path';
import { maskedText, textMask, textShape } from './text-paint';
import { blocked } from '../shared/layers';
import type { Rect } from '../shared/geometry';
import { pathArrows, strokeBounds, strokeShadowCaster, strokeStyle } from '../shared/stroke';

function paintStroke(c: CanvasRenderingContext2D, n: Node, r: Rect, points: PathPoint[], shape: Path2D | (() => void), color: string) {
    const { align, cap, join, miter, dash, width } = strokeStyle(n);
    c.save();
    if (align === 'inside') {
        if (typeof shape === 'function') c.clip('evenodd');
        else c.clip(shape, 'evenodd');
    }
    else if (align === 'outside') {
        const b = strokeBounds(n, r, points);
        const outer = [b.x - 1, b.y - 1, b.w + 2, b.h + 2] as const;
        if (typeof shape === 'function') {
            c.beginPath();
            c.rect(...outer);
            shape();
            c.clip('evenodd');
            c.beginPath();
            shape();
        }
        else {
            const ring = new Path2D();
            ring.rect(...outer);
            ring.addPath(shape);
            c.clip(ring, 'evenodd');
        }
    }
    c.lineWidth = width;
    c.lineCap = cap;
    c.lineJoin = join;
    c.miterLimit = miter;
    if (dash.length) c.setLineDash(dash);
    c.strokeStyle = color;
    if (typeof shape === 'function') c.stroke();
    else c.stroke(shape);
    c.restore();

    const arrows = pathArrows(n, points);
    if (!arrows.length) return;
    c.save();
    c.fillStyle = c.strokeStyle = color;
    c.lineWidth = n.strokeWidth;
    c.lineJoin = c.lineCap = 'round';
    for (const arrow of arrows) {
        c.beginPath();
        if (arrow.kind === 'circle') {
            c.arc(arrow.center.x, arrow.center.y, arrow.radius, 0, 2 * Math.PI);
            c.fill();
        }
        else {
            const [first, ...rest] = arrow.points;
            c.moveTo(first.x, first.y);
            for (const p of rest) c.lineTo(p.x, p.y);
            if (arrow.kind === 'fill') { c.closePath(); c.fill(); }
            else c.stroke();
        }
    }
    c.restore();
}

type DrawOptions = { zoom: number; labels: boolean; skip?: string; scale?: number; file?: string; invalidate?: () => void };
export function drawNode(c: CanvasRenderingContext2D, doc: Doc, n: Node, opts: DrawOptions) {
    if (blocked(doc, n, false) || opts.skip === n.id) return;
    if (n.type === 'group') { for (const child of children(doc, n.id)) drawNode(c, doc, child, opts); return; }
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
    const points = n.type === 'path' ? toAbs(n.points ?? [], r) : [];
    const shape = () => {
        if (n.type === 'path')
            contoursAbs(n, r).forEach((abs, i) => trace(c, abs, i > 0 || !!n.closed));
        else if (n.type === 'ellipse') {
            c.moveTo(r.x + r.w, r.y + r.h / 2);
            c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
            c.closePath();
        }
        else
            c.roundRect(r.x, r.y, r.w, r.h, Math.min(n.radius, r.w / 2, r.h / 2));
    };
    c.beginPath();
    shape();
    const style = n.stroke && n.strokeWidth > 0 ? strokeStyle(n) : undefined;
    if (n.type !== 'path' || n.closed) {
        c.fillStyle = n.fill;
        c.fill(n.type === 'path' || style && style.align !== 'center' ? 'evenodd' : 'nonzero');
    }
    if (n.stroke && style) paintStroke(c, n, r, points, shape, n.stroke);
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
function drawStrokeShadow(target: CanvasRenderingContext2D, caster: Node, r: Rect, points: PathPoint[], shape: Path2D, effect: Extract<Effect, { spread: number }>, scale: number) {
    const bounds = strokeBounds(caster, r, points), { e, f } = target.getTransform();
    const dx = effect.x * scale, dy = effect.y * scale, blur = effect.blur * scale, pad = blur * 4 + 2;
    const x = Math.floor(Math.max(bounds.x * scale + e - 1, -dx - pad));
    const y = Math.floor(Math.max(bounds.y * scale + f - 1, -dy - pad));
    const w = Math.ceil(Math.min((bounds.x + bounds.w) * scale + e + 1, target.canvas.width - dx + pad)) - x;
    const h = Math.ceil(Math.min((bounds.y + bounds.h) * scale + f + 1, target.canvas.height - dy + pad)) - y;
    if (w <= 0 || h <= 0) return;

    // Rasterize the stroke separately so its alignment clip doesn't clip the offset shadow.
    const resolution = Math.min(1, 4096 / Math.max(w, h)), buffer = document.createElement('canvas');
    buffer.width = Math.max(1, Math.floor(w * resolution));
    buffer.height = Math.max(1, Math.floor(h * resolution));
    const c = buffer.getContext('2d');
    if (!c) return;
    const sx = buffer.width / w, sy = buffer.height / h;
    c.setTransform(scale * sx, 0, 0, scale * sy, (e - x) * sx, (f - y) * sy);
    paintStroke(c, caster, r, points, shape, '#000');

    const sourceX = -w - 2;
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.shadowColor = rgba(effect.color, effect.opacity);
    target.shadowBlur = blur;
    target.shadowOffsetX = x + dx - sourceX;
    target.shadowOffsetY = dy;
    target.drawImage(buffer, sourceX, y, w, h);
    target.restore();
}

function drawPaintedNode(target: CanvasRenderingContext2D, doc: Doc, n: Node, opts: DrawOptions, layered = false, backdrop?: HTMLCanvasElement) {
    const r = world(doc, n), effects = (n.effects ?? []).filter(e => e.visible && (n.type !== 'path' || n.closed || e.type !== 'background-blur' && e.type !== 'inner-shadow')), scale = opts.scale ?? opts.zoom, layer = effects.filter(e => e.type === 'layer-blur');
    if (layer.length && !layered) { const underneath = snapshot(target.canvas), buffer = snapshot(target.canvas), b = buffer.getContext('2d')!; b.clearRect(0, 0, buffer.width, buffer.height); b.setTransform(target.getTransform()); drawPaintedNode(b, doc, n, opts, true, underneath); target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.filter = layer.map(e => `blur(${e.type === 'layer-blur' ? e.radius * scale : 0}px)`).join(' '); target.drawImage(buffer, 0, 0); target.restore(); return; }
    const points = n.type === 'path' ? toAbs(n.points ?? [], r) : [];
    const path = (spread = 0) => { const p = new Path2D(), w = Math.max(.001, r.w + 2 * spread), h = Math.max(.001, r.h + 2 * spread); if (n.type === 'path') { const original = new Path2D(); contoursAbs(n, r).forEach((abs, i) => trace(original, abs, i > 0 || !!n.closed)); if (spread) p.addPath(original, new DOMMatrix([w / r.w, 0, 0, h / r.h, r.x - spread - r.x * w / r.w, r.y - spread - r.y * h / r.h])); else return original; } else if (n.type === 'ellipse') { p.ellipse(r.x + r.w / 2, r.y + r.h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); p.closePath(); } else p.roundRect(r.x - spread, r.y - spread, w, h, Math.max(0, Math.min(n.radius + spread, w / 2, h / 2))); return p; }, shape = path();
    target.save(); target.globalAlpha *= n.opacity;
    const fillRule = n.type === 'path' || n.stroke && n.strokeWidth > 0 && strokeStyle(n).align !== 'center' ? 'evenodd' : 'nonzero';
    const text = isTextNode(n) ? n : undefined, mask = text && effects.some(e => e.type === 'background-blur' || e.type === 'inner-shadow') ? textMask(target, text, r) : undefined;
    const clipShape = (draw: (c: CanvasRenderingContext2D) => void) => { if (mask) maskedText(target, mask, draw); else { target.save(); target.clip(shape, fillRule); draw(target); target.restore(); } };
    const hasFill = (n.type !== 'path' || !!n.closed) && nodeFills(n).some(p => p.visible && p.opacity > 0 && (p.type !== 'linear' && p.type !== 'radial' || p.stops.some(s => s.opacity > 0))), hasStroke = !!n.stroke && n.strokeWidth > 0;
    for (const e of effects) {
        if (e.type !== 'drop-shadow' || !hasFill && !hasStroke) continue;
        const align = strokeStyle(n).align, caster = strokeShadowCaster(n, e.spread);
        if (!text && !hasFill && caster.strokeWidth <= 0) continue;
        if (!text && !hasFill && (align !== 'center' || pathArrows(caster, points).length)) {
            drawStrokeShadow(target, caster, r, points, shape, e, scale);
            continue;
        }
        const ink = !text && !hasFill ? strokeBounds(caster, r, points) : r;
        const shift = (target.canvas.width + target.canvas.height) / scale + ink.w + ink.h + Math.abs(e.spread) * 2 + e.blur * 4;
        target.save();
        target.translate(-shift, 0);
        target.shadowColor = rgba(e.color, e.opacity);
        target.shadowBlur = e.blur * scale;
        target.shadowOffsetX = (shift + e.x) * scale;
        target.shadowOffsetY = e.y * scale;
        target.fillStyle = '#000';
        if (text) {
            target.translate(shift, 0);
            const glyphs = textMask(target, text, r, e.spread, !hasFill);
            target.setTransform(1, 0, 0, 1, 0, 0);
            target.drawImage(glyphs.canvas, -shift * scale + glyphs.x, glyphs.y, glyphs.w, glyphs.h);
        }
        else if (hasFill) target.fill(path(e.spread), fillRule);
        else paintStroke(target, caster, r, points, shape, '#000');
        target.restore();
    }
    for (const e of effects) if (e.type === 'background-blur') { const copy = backdrop ?? snapshot(target.canvas); clipShape(c => { c.setTransform(1, 0, 0, 1, 0, 0); c.filter = `blur(${e.radius * scale}px)`; c.drawImage(copy, 0, 0); }); }
    for (const paint of nodeFills(n)) if (paint.visible && (n.type !== 'path' || n.closed)) {
        target.save(); target.globalAlpha *= paint.opacity;
        if (text && paint.type === 'radial') maskedText(target, textMask(target, text, r), c => { c.translate(r.x, r.y); c.scale(r.w, r.h); const style = paintStyle(c, paint, r, opts.file ?? 'untitled', opts.invalidate ?? (() => {})), ink = textPaintBounds(text); if (style) { c.fillStyle = style; c.fillRect(ink.x / r.w, ink.y / r.h, ink.w / r.w, ink.h / r.h); } });
        else { let fillShape = shape; if (paint.type === 'radial') { target.translate(r.x, r.y); target.scale(r.w, r.h); fillShape = new Path2D(); fillShape.addPath(shape, new DOMMatrix([1 / r.w, 0, 0, 1 / r.h, -r.x / r.w, -r.y / r.h])); } const style = paintStyle(target, paint, r, opts.file ?? location.pathname.split('/')[2] ?? 'untitled', opts.invalidate ?? (() => {})); if (style) { target.fillStyle = style; if (text) textShape(target, text, r); else target.fill(fillShape, fillRule); } }
        target.restore();
    }
    if (n.stroke && n.strokeWidth > 0) {
        if (text) { target.lineWidth = n.strokeWidth; target.strokeStyle = n.stroke; textShape(target, text, r, true); }
        else paintStroke(target, n, r, points, shape, n.stroke);
    }
    for (const e of effects) if (e.type === 'inner-shadow') { if (text && mask) { clipShape(c => { const hole = e.spread ? textMask(target, text, r, -e.spread) : mask, inverse = snapshot(hole.canvas), b = inverse.getContext('2d')!; b.globalCompositeOperation = 'source-out'; b.fillStyle = '#000'; b.fillRect(0, 0, inverse.width, inverse.height); const shift = hole.w + hole.h + e.blur * scale * 4; c.setTransform(1, 0, 0, 1, 0, 0); c.shadowColor = rgba(e.color, e.opacity); c.shadowBlur = e.blur * scale; c.shadowOffsetX = shift + e.x * scale; c.shadowOffsetY = e.y * scale; c.drawImage(inverse, -shift + hole.x, hole.y, hole.w, hole.h); }); continue; } target.save(); target.clip(shape, fillRule); const ring = new Path2D(); const margin = Math.max(r.w, r.h) + e.blur * 4 + Math.abs(e.spread) + Math.abs(e.x) + Math.abs(e.y), shift = (target.canvas.width + target.canvas.height) / scale + margin * 4; ring.rect(r.x - margin, r.y - margin, r.w + margin * 2, r.h + margin * 2); ring.addPath(path(-e.spread)); target.fillStyle = '#000'; target.shadowColor = rgba(e.color, e.opacity); target.shadowBlur = e.blur * scale; target.shadowOffsetX = (shift + e.x) * scale; target.shadowOffsetY = e.y * scale; target.translate(-shift, 0); target.fill(ring, 'evenodd'); target.restore(); }
    if (n.type === 'frame') { target.clip(shape, fillRule); for (const child of children(doc, n.id)) drawNode(target, doc, child, opts); }
    target.restore(); if (n.type === 'frame' && opts.labels) { target.fillStyle = '#77766f'; target.font = `${11 / opts.zoom}px system-ui`; target.fillText(n.name, r.x, r.y - 8 / opts.zoom); }
}
