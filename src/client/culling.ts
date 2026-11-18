import { isTextNode, type Doc, type Node } from '../shared/doc';
import { bounds, intersects, transformedBounds, type Rect } from '../shared/geometry';
import { toAbs } from '../shared/path';
import { strokeBounds, strokeShadowCaster } from '../shared/stroke';
import { world, worldMatrix } from './geometry';
import { textPaintBounds } from './text-layout';

export function renderBounds(doc: Doc, node: Node, zoom: number, labelWidth = 0): Rect {
    const r = world(doc, node);
    const ink = isTextNode(node) ? textPaintBounds(node) : { x: 0, y: 0, w: r.w, h: r.h };
    const points = node.type === 'path' ? toAbs(node.points ?? [], r) : [];
    const shape = points.length ? bounds([r, ...points.flatMap(p => [{ x: p.x, y: p.y, w: 0, h: 0 }, { x: p.ix, y: p.iy, w: 0, h: 0 }, { x: p.ox, y: p.oy, w: 0, h: 0 }])]) : { x: r.x + ink.x, y: r.y + ink.y, w: ink.w, h: ink.h };
    const painted = strokeBounds(node, shape, points), regions = [painted];
    let blur = 0;
    for (const effect of node.effects ?? []) if (effect.visible) {
        if (effect.type === 'layer-blur') blur += effect.radius * 4;
        if (effect.type === 'drop-shadow') {
            const caster = strokeBounds(strokeShadowCaster(node, Math.max(0, effect.spread)), shape, points);
            const pad = Math.max(0, effect.spread) + effect.blur * 4;
            regions.push({ x: caster.x + effect.x - pad, y: caster.y + effect.y - pad, w: caster.w + 2 * pad, h: caster.h + 2 * pad });
        }
    }
    const box = bounds(regions), pad = blur + 2 / zoom;
    const result = { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };
    const labeled = node.type === 'frame' && labelWidth > 0 ? bounds([result, { x: r.x - 2 / zoom, y: r.y - 24 / zoom, w: (labelWidth + 4) / zoom, h: 26 / zoom }]) : result;
    return transformedBounds(worldMatrix(doc, node), { ...labeled, x: labeled.x - r.x, y: labeled.y - r.y });
}

export function inViewport(doc: Doc, node: Node, viewport: Rect, zoom: number, labelWidth = 0) {
    return node.type === 'group' || intersects(renderBounds(doc, node, zoom, labelWidth), viewport);
}
