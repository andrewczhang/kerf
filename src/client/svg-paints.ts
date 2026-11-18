import { nodeFills, type Node } from '../shared/doc';
import type { Rect } from '../shared/geometry';
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function svgPaints(n: Node, r: Rect, tag: string, geometry: string, alpha: number, nested: string, nextId: () => string, content = '') {
    let defs = '', primitives = '';
    const primitive = (attributes: string) => tag === 'text' ? `<text ${geometry} ${attributes}>${content}</text>` : `<${tag} ${geometry} ${attributes}/>`;
    for (const p of nodeFills(n)) if (p.visible && (n.type !== 'path' || n.closed)) {
        let fill: string;
        if (p.type === 'solid' || p.type === 'image') fill = escape(p.type === 'solid' ? p.color : n.fill);
        else { const id = nextId(), radial = p.type === 'radial', gradientTag = radial ? 'radialGradient' : 'linearGradient', coordinates = radial ? `cx="${p.from.x}" cy="${p.from.y}" r="${Math.max(.000001, Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y))}"` : `x1="${r.x + p.from.x * r.w}" y1="${r.y + p.from.y * r.h}" x2="${r.x + p.to.x * r.w}" y2="${r.y + p.to.y * r.h}"`; defs += `<${gradientTag} id="${id}" gradientUnits="${radial && tag !== 'text' ? 'objectBoundingBox' : 'userSpaceOnUse'}"${radial && tag === 'text' ? ` gradientTransform="matrix(${r.w} 0 0 ${r.h} ${r.x} ${r.y})"` : ''} ${coordinates}>${[...p.stops].sort((a,b) => a.pos-b.pos).map(s => `<stop offset="${s.pos}" stop-color="${escape(s.color)}" stop-opacity="${s.opacity}"/>`).join('')}</${gradientTag}>`; fill = `url(#${id})`; }
        primitives += primitive(`fill="${fill}" fill-opacity="${p.opacity}"`);
    }
    if (n.stroke && n.strokeWidth > 0) primitives += primitive(`fill="none" stroke="${escape(n.stroke)}" stroke-width="${n.strokeWidth}"`);
    const effects = (n.effects ?? []).filter(e => e.visible), shadows: string[] = []; let steps = '', count = 0, pad = n.stroke ? n.strokeWidth / 2 : 0;
    for (const e of effects) if (e.type === 'drop-shadow') { const id = 'shadow' + count++, size = Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.spread) + e.blur * 2; pad = Math.max(pad, size); if (e.spread) steps += `<feMorphology in="SourceAlpha" operator="${e.spread > 0 ? 'dilate' : 'erode'}" radius="${Math.abs(e.spread)}" result="${id}-spread"/>`; steps += `<feGaussianBlur in="${e.spread ? id + '-spread' : 'SourceAlpha'}" stdDeviation="${e.blur / 2}" result="${id}-blur"/><feOffset in="${id}-blur" dx="${e.x}" dy="${e.y}" result="${id}-offset"/><feFlood flood-color="${escape(e.color)}" flood-opacity="${e.opacity}"/><feComposite in2="${id}-offset" operator="in" result="${id}"/>`; shadows.push(id); }
    if (shadows.length) steps += `<feMerge result="shadowed">${shadows.map(id => `<feMergeNode in="${id}"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge>`;
    let input = shadows.length ? 'shadowed' : 'SourceGraphic';
    for (const e of effects) if (e.type === 'layer-blur') { const result = 'layer' + count++; steps += `<feGaussianBlur in="${input}" stdDeviation="${e.radius}" result="${result}"/>`; input = result; pad += e.radius * 3; }
    let filter = ''; if (steps) { const id = nextId(); pad = Math.max(1, pad); defs += `<filter id="${id}" filterUnits="userSpaceOnUse" x="${r.x-pad}" y="${r.y-pad}" width="${r.w+pad*2}" height="${r.h+pad*2}" color-interpolation-filters="sRGB">${steps}</filter>`; filter = ` filter="url(#${id})"`; }
    return `<g id="${escape(n.id)}" data-name="${escape(n.name)}"${alpha === 1 ? '' : ` opacity="${alpha}"`}${filter}>${defs ? `<defs>${defs}</defs>` : ''}${primitives}${nested}</g>`;
}
