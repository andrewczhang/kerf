import type { TextNode } from '../shared/doc';
import { font, measureTextNode } from './text-layout';
import type { Rect } from '../shared/geometry';
type TextMask = { canvas: HTMLCanvasElement; pad: number };

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
    const pad = Math.ceil(extent * scale), mask = document.createElement('canvas'); mask.width = target.canvas.width + pad * 2; mask.height = target.canvas.height + pad * 2;
    const c = mask.getContext('2d')!; c.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e + pad, transform.f + pad);
    if (!stroke) textShape(c, n, r);
    const width = stroke ? n.strokeWidth + spread * 2 : Math.abs(spread) * 2;
    if (width > 0) { c.lineWidth = width; c.lineJoin = 'round'; if (!stroke && spread < 0) c.globalCompositeOperation = 'destination-out'; textShape(c, n, r, true); }
    return { canvas: mask, pad };
}

export function maskedText(target: CanvasRenderingContext2D, mask: TextMask, draw: (c: CanvasRenderingContext2D) => void) {
    const buffer = document.createElement('canvas'); buffer.width = target.canvas.width; buffer.height = target.canvas.height;
    const c = buffer.getContext('2d')!; c.setTransform(target.getTransform()); draw(c);
    c.setTransform(1, 0, 0, 1, 0, 0); c.filter = 'none'; c.shadowColor = 'transparent'; c.globalCompositeOperation = 'destination-in'; c.drawImage(mask.canvas, -mask.pad, -mask.pad);
    target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.drawImage(buffer, 0, 0); target.restore();
}
