import { children, isTextNode, type Doc, type Node } from '../shared/doc';
import { world, worldMatrix } from './geometry';
import { inverse, multiply, type Mat } from '../shared/geometry';
import { font, measureTextNode } from './text-layout';
import { toAbs, trace } from '../shared/path';

export function drawNode(c: CanvasRenderingContext2D, doc: Doc, n: Node, opts: { zoom: number; labels: boolean; skip?: string }, applied?: Mat) {
    if (n.hidden)
        return;
    if (n.type === 'group') {
        for (const child of children(doc, n.id))
            drawNode(c, doc, child, opts, applied);
        return;
    }
    if (opts.skip === n.id)
        return;
    const r = world(doc, n), m = worldMatrix(doc, n), matrix: Mat = [m[0], m[1], m[2], m[3], m[4] - m[0] * r.x - m[2] * r.y, m[5] - m[1] * r.x - m[3] * r.y];
    c.save();
    const relative = applied ? multiply(inverse(applied), matrix) : matrix;
    if (relative.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > 1e-10)) c.transform(...relative);
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
        c.save();
        c.clip();
        for (const child of children(doc, n.id))
            drawNode(c, doc, child, opts, matrix);
        c.restore();
    }
    if (n.type === 'frame' && opts.labels) {
        c.fillStyle = '#77766f';
        c.font = `${11 / opts.zoom}px system-ui`;
        c.fillText(n.name, r.x, r.y - 8 / opts.zoom);
    }
    c.restore();
}
