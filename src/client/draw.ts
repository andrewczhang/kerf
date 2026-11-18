import { children, isTextNode, type Doc, type Node } from '../shared/doc';
import { world } from './geometry';
import { font, measureTextNode } from './text-layout';

export function drawNode(c: CanvasRenderingContext2D, doc: Doc, n: Node, opts: { zoom: number; labels: boolean; skip?: string }) {
    if (opts.skip === n.id)
        return;
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
