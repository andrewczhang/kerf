import type { Doc } from '../shared/doc';
import { blocked } from '../shared/layers';
import { gridBands, gridLines } from '../shared/layout-grid';
import { worldMatrix } from './geometry';

export function drawLayoutGrids(c: CanvasRenderingContext2D, doc: Doc, zoom: number) {
    for (const n of doc.values()) {
        if (n.type !== 'frame' || blocked(doc, n, false) || !n.grids?.length) continue;
        const r = { x: 0, y: 0, w: n.w, h: n.h };
        c.save();
        let p = n;
        for (;;) {
            if (p.type === 'frame') { c.save(); c.transform(...worldMatrix(doc, p)); c.beginPath(); c.roundRect(0, 0, p.w, p.h, Math.min(p.radius, p.w / 2, p.h / 2)); c.restore(); c.clip(); }
            if (!p.parent || !doc.has(p.parent)) break;
            p = doc.get(p.parent)!;
        }
        c.transform(...worldMatrix(doc, n));
        for (const g of n.grids) {
            if (!g.visible) continue;
            c.globalAlpha = g.opacity; c.fillStyle = c.strokeStyle = g.color;
            if (g.type !== 'grid') for (const b of gridBands(r, g)) c.fillRect(b.x, b.y, b.w, b.h);
            else { c.lineWidth = 1 / zoom; c.beginPath(); for (const l of gridLines(r, g, zoom)) { if (l.axis === 'x') { c.moveTo(l.position, r.y); c.lineTo(l.position, r.y + r.h); } else { c.moveTo(r.x, l.position); c.lineTo(r.x + r.w, l.position); } } c.stroke(); }
        }
        c.restore();
    }
}
