import { childIndex, isTextNode, type Doc, type Node } from '../shared/doc';
import { world } from './geometry';
import { font, measureTextNode } from './text-layout';
import { toAbs, trace } from '../shared/path';

export function drawNode(c: CanvasRenderingContext2D, doc: Doc, n: Node, opts: { zoom: number; labels: boolean; skip?: string; tree?: Map<string | null, Node[]> }) {
    if (opts.skip === n.id) return;
    if (!opts.tree) opts = { ...opts, tree: childIndex(doc) };
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
        for (const child of opts.tree!.get(n.id) ?? [])
            drawNode(c, doc, child, opts);
    }
    c.restore();
    if (n.type === 'frame' && opts.labels) {
        c.fillStyle = '#77766f';
        c.strokeStyle = '#77766f';
        if (n.instanceOf && !doc.has(n.instanceOf)) {
            c.lineWidth = 1 / opts.zoom;
            c.setLineDash([4 / opts.zoom, 3 / opts.zoom]);
            c.strokeRect(r.x, r.y, r.w, r.h);
            c.setLineDash([]);
        }
        if (n.component || n.instanceOf) {
            c.save();
            c.translate(r.x, r.y - 13 / opts.zoom);
            c.scale(1 / opts.zoom, 1 / opts.zoom);
            c.lineWidth = 1;
            for (const [x, y] of [[5, 0], [0, 5], [10, 5], [5, 10]]) {
                c.beginPath(); c.moveTo(x, y - 3); c.lineTo(x + 3, y); c.lineTo(x, y + 3); c.lineTo(x - 3, y); c.closePath();
                if (n.instanceOf) c.stroke(); else c.fill();
            }
            c.restore();
        }
        c.font = `${11 / opts.zoom}px system-ui`;
        c.fillText(n.name, r.x + (n.component || n.instanceOf ? 19 / opts.zoom : 0), r.y - 8 / opts.zoom);
    }
}
