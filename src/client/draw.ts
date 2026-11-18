import { children, type Doc, type Node } from '../shared/doc';
import { world } from '../shared/geometry';
export function drawNode(c: CanvasRenderingContext2D, doc: Doc, n: Node, zoom = 1, labels = true) {
    const r = world(doc, n);
    c.save(); c.globalAlpha *= n.opacity; c.beginPath();
    if (n.type === 'ellipse') c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    else c.roundRect(r.x, r.y, r.w, r.h, Math.min(n.radius, r.w / 2, r.h / 2));
    c.fillStyle = n.fill; c.fill();
    if (n.stroke) { c.lineWidth = n.strokeWidth; c.strokeStyle = n.stroke; c.stroke(); }
    if (n.type === 'frame') { c.clip(); for (const child of children(doc, n.id)) drawNode(c, doc, child, zoom, labels); }
    c.restore();
    if (labels && n.type === 'frame') { c.fillStyle = '#77766f'; c.font = `${11 / zoom}px system-ui`; c.fillText(n.name, r.x, r.y - 8 / zoom); }
}
