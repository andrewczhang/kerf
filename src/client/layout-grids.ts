import type { Doc } from '../shared/doc';
import { blocked } from '../shared/layers';
import { gridBands, gridLines } from '../shared/layout-grid';
import { world } from './geometry';

export function drawLayoutGrids(c: CanvasRenderingContext2D, doc: Doc, zoom: number) {
    for (const n of doc.values()) {
        if (n.type !== 'frame' || blocked(doc, n, false) || !n.grids?.length) continue;
        const r = world(doc, n);
        c.save();
        let p = n;
        for (;;) {
            if (p.type === 'frame') { const b = world(doc, p); c.beginPath(); c.roundRect(b.x, b.y, b.w, b.h, Math.min(p.radius, b.w / 2, b.h / 2)); c.clip(); }
            if (!p.parent || !doc.has(p.parent)) break;
            p = doc.get(p.parent)!;
        }
        for (const g of n.grids) {
            if (!g.visible) continue;
            c.globalAlpha = g.opacity; c.fillStyle = c.strokeStyle = g.color;
            if (g.type !== 'grid') for (const b of gridBands(r, g)) c.fillRect(b.x, b.y, b.w, b.h);
            else { c.lineWidth = 1 / zoom; c.beginPath(); for (const l of gridLines(r, g, zoom)) { if (l.axis === 'x') { c.moveTo(l.position, r.y); c.lineTo(l.position, r.y + r.h); } else { c.moveTo(r.x, l.position); c.lineTo(r.x + r.w, l.position); } } c.stroke(); }
        }
        c.restore();
    }
}
