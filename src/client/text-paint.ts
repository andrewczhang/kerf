import type { TextNode } from '../shared/doc';
import { font, measureTextNode, textPaintBounds } from './text-layout';
import type { Rect } from '../shared/geometry';
type TextMask = { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number };

export function textShape(c: CanvasRenderingContext2D, n: TextNode, r: Rect, stroke = false) {
    const { lines, leading, baseline, offset } = measureTextNode(n);
    c.font = font(n); c.textAlign = n.textAlign;
    for (const [i, line] of lines.entries()) {
        if (stroke) c.strokeText(line, r.x + offset, r.y + baseline + i * leading);
        else c.fillText(line, r.x + offset, r.y + baseline + i * leading);
    }
}

export function textMask(target: CanvasRenderingContext2D, n: TextNode, r: Rect, spread = 0, stroke = false) {
    const transform = target.getTransform(), scale = Math.max(Math.hypot(transform.a, transform.b), Math.hypot(transform.c, transform.d));
    let extent = Math.abs(spread) + (stroke ? n.strokeWidth / 2 : 0);
    for (const e of n.effects ?? []) if (e.visible) extent = Math.max(extent, 'radius' in e ? e.radius * 3 : Math.max(Math.abs(e.x), Math.abs(e.y)) + e.blur * 2 + Math.abs(e.spread));
    const ink = textPaintBounds(n), corners = [[r.x + ink.x, r.y + ink.y], [r.x + ink.x + ink.w, r.y + ink.y], [r.x + ink.x, r.y + ink.y + ink.h], [r.x + ink.x + ink.w, r.y + ink.y + ink.h]].map(([x, y]) => ({ x: transform.a * x + transform.c * y + transform.e, y: transform.b * x + transform.d * y + transform.f }));
    const left = Math.min(...corners.map(p => p.x)), top = Math.min(...corners.map(p => p.y)), right = Math.max(...corners.map(p => p.x)), bottom = Math.max(...corners.map(p => p.y)), width = target.canvas.width, height = target.canvas.height;
    const region = (pad: number) => { const x = Math.floor(Math.max(-pad, left - pad)), y = Math.floor(Math.max(-pad, top - pad)); return { x, y, w: Math.max(1, Math.ceil(Math.min(width + pad, right + pad)) - x), h: Math.max(1, Math.ceil(Math.min(height + pad, bottom + pad)) - y) }; };
    const budget = Math.min(4_000_000, Math.max(1, width * height * 2));
    let low = 0, high = Math.min(Math.ceil(extent * scale), Math.max(width, height)), box = region(high);
    if (box.w * box.h > budget) { while (low < high) { const mid = Math.ceil((low + high) / 2), candidate = region(mid); if (candidate.w * candidate.h <= budget) low = mid; else high = mid - 1; } box = region(low); }
    const resolution = Math.min(1, Math.sqrt(budget / (box.w * box.h))), mask = document.createElement('canvas'); mask.width = Math.max(1, Math.floor(box.w * resolution)); mask.height = Math.max(1, Math.floor(box.h * resolution));
    const sx = mask.width / box.w, sy = mask.height / box.h, c = mask.getContext('2d')!; c.setTransform(transform.a * sx, transform.b * sy, transform.c * sx, transform.d * sy, (transform.e - box.x) * sx, (transform.f - box.y) * sy);
    if (!stroke) textShape(c, n, r);
    const strokeWidth = stroke ? n.strokeWidth + spread * 2 : Math.abs(spread) * 2;
    if (strokeWidth > 0) { c.lineWidth = strokeWidth; c.lineJoin = 'round'; if (!stroke && spread < 0) c.globalCompositeOperation = 'destination-out'; textShape(c, n, r, true); }
    return { canvas: mask, ...box };
}

export function maskedText(target: CanvasRenderingContext2D, mask: TextMask, draw: (c: CanvasRenderingContext2D) => void) {
    const buffer = document.createElement('canvas'); buffer.width = target.canvas.width; buffer.height = target.canvas.height;
    const c = buffer.getContext('2d')!; c.setTransform(target.getTransform()); draw(c);
    c.setTransform(1, 0, 0, 1, 0, 0); c.filter = 'none'; c.shadowColor = 'transparent'; c.globalCompositeOperation = 'destination-in'; c.drawImage(mask.canvas, mask.x, mask.y, mask.w, mask.h);
    target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.drawImage(buffer, 0, 0); target.restore();
}
