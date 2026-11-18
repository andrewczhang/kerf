import type { TextNode } from '../shared/doc';
import { font, measureTextNode } from './text-layout';
import type { Rect } from '../shared/geometry';

export function textShape(c: CanvasRenderingContext2D, n: TextNode, r: Rect, stroke = false) {
    const { lines, leading, baseline, offset } = measureTextNode(n);
    c.font = font(n); c.textAlign = n.textAlign;
    for (const [i, line] of lines.entries()) {
        if (stroke) c.strokeText(line, r.x + offset, r.y + baseline + i * leading);
        else c.fillText(line, r.x + offset, r.y + baseline + i * leading);
    }
}

export function textMask(target: CanvasRenderingContext2D, n: TextNode, r: Rect, spread = 0, stroke = false) {
    const mask = document.createElement('canvas'); mask.width = target.canvas.width; mask.height = target.canvas.height;
    const c = mask.getContext('2d')!; c.setTransform(target.getTransform());
    if (!stroke) textShape(c, n, r);
    const width = stroke ? n.strokeWidth + spread * 2 : Math.abs(spread) * 2;
    if (width > 0) { c.lineWidth = width; c.lineJoin = 'round'; if (!stroke && spread < 0) c.globalCompositeOperation = 'destination-out'; textShape(c, n, r, true); }
    return mask;
}

export function maskedText(target: CanvasRenderingContext2D, mask: HTMLCanvasElement, draw: (c: CanvasRenderingContext2D) => void) {
    const buffer = document.createElement('canvas'); buffer.width = target.canvas.width; buffer.height = target.canvas.height;
    const c = buffer.getContext('2d')!; c.setTransform(target.getTransform()); draw(c);
    c.setTransform(1, 0, 0, 1, 0, 0); c.filter = 'none'; c.shadowColor = 'transparent'; c.globalCompositeOperation = 'destination-in'; c.drawImage(mask, 0, 0);
    target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.drawImage(buffer, 0, 0); target.restore();
}
