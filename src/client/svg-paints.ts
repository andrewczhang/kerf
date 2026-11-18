import { nodeFills, type Node } from '../shared/doc';
import type { Rect } from '../shared/geometry';
import type { PathPoint } from '../shared/path';
import { pathArrows, strokeBounds, strokeStyle } from '../shared/stroke';
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function svgStroke(n: Node, r: Rect, tag: string, geometry: string, points: PathPoint[], opacity: number, nextId: () => string) {
    if (!n.stroke || n.strokeWidth <= 0)
        return { inline: '', extra: '', fillRule: '' };
    const color = escape(n.stroke);
    const { align, cap, join, miter, dash, width } = strokeStyle(n);
    const attrs = ` stroke="${color}" stroke-width="${width}"${opacity === 1 ? '' : ` stroke-opacity="${opacity}"`} stroke-linecap="${cap}" stroke-linejoin="${join}" stroke-miterlimit="${miter}"${dash.length ? ` stroke-dasharray="${dash.join(' ')}"` : ''}`;
    let extra = '';
    if (align !== 'center') {
        const id = nextId();
        if (align === 'inside')
            extra = `<defs><clipPath id="${id}"><${tag} ${geometry} clip-rule="evenodd"/></clipPath></defs><${tag} ${geometry} fill="none"${attrs} clip-path="url(#${id})"/>`;
        else {
            const b = strokeBounds(n, r, points);
            const region = `x="${b.x - 1}" y="${b.y - 1}" width="${b.w + 2}" height="${b.h + 2}"`;
            extra = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" ${region}><rect ${region} fill="white"/><${tag} ${geometry} fill="black"${geometry.includes('fill-rule=') ? '' : ' fill-rule="evenodd"'}/></mask></defs><${tag} ${geometry} fill="none"${attrs} mask="url(#${id})"/>`;
        }
    }
    const arrowOpacity = opacity === 1 ? '' : ` opacity="${opacity}"`;
    for (const arrow of pathArrows(n, points)) {
        if (arrow.kind === 'circle')
            extra += `<circle cx="${arrow.center.x}" cy="${arrow.center.y}" r="${arrow.radius}" fill="${color}"${arrowOpacity}/>`;
        else {
            const coords = arrow.points.map(p => `${p.x},${p.y}`).join(' ');
            extra += arrow.kind === 'fill'
                ? `<polygon points="${coords}" fill="${color}"${arrowOpacity}/>`
                : `<polyline points="${coords}" fill="none" stroke="${color}" stroke-width="${n.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${arrowOpacity}/>`;
        }
    }
    return { inline: align === 'center' ? attrs : '', extra, fillRule: align === 'center' || geometry.includes('fill-rule=') ? '' : ' fill-rule="evenodd"' };
}

export function svgPaints(n: Node, r: Rect, tag: string, geometry: string, alpha: number, nested: string, nextId: () => string, content = '', points?: PathPoint[]) {
    let defs = '', primitives = '';
    const stroke = points && svgStroke(n, r, tag, geometry, points, 1, nextId);
    const primitive = (attributes: string) => tag === 'text' ? `<text ${geometry} ${attributes}>${content}</text>` : `<${tag} ${geometry} ${attributes}/>`;
    for (const p of nodeFills(n)) if (p.visible && (n.type !== 'path' || n.closed)) {
        let fill: string;
        if (p.type === 'solid' || p.type === 'image') fill = escape(p.type === 'solid' ? p.color : n.fill);
        else { const id = nextId(), radial = p.type === 'radial', gradientTag = radial ? 'radialGradient' : 'linearGradient', coordinates = radial ? `cx="${p.from.x}" cy="${p.from.y}" r="${Math.max(.000001, Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y))}"` : `x1="${r.x + p.from.x * r.w}" y1="${r.y + p.from.y * r.h}" x2="${r.x + p.to.x * r.w}" y2="${r.y + p.to.y * r.h}"`; defs += `<${gradientTag} id="${id}" gradientUnits="${radial && tag !== 'text' ? 'objectBoundingBox' : 'userSpaceOnUse'}"${radial && tag === 'text' ? ` gradientTransform="matrix(${r.w} 0 0 ${r.h} ${r.x} ${r.y})"` : ''} ${coordinates}>${[...p.stops].sort((a,b) => a.pos-b.pos).map(s => `<stop offset="${s.pos}" stop-color="${escape(s.color)}" stop-opacity="${s.opacity}"/>`).join('')}</${gradientTag}>`; fill = `url(#${id})`; }
        primitives += primitive(`fill="${fill}" fill-opacity="${p.opacity}"${stroke?.fillRule ?? ''}`);
    }
    if (stroke) primitives += (stroke.inline ? primitive(`fill="none"${stroke.inline}`) : '') + stroke.extra;
    else if (n.stroke && n.strokeWidth > 0) primitives += primitive(`fill="none" stroke="${escape(n.stroke)}" stroke-width="${n.strokeWidth}"`);
    const effects = (n.effects ?? []).filter(e => e.visible), shadows: string[] = []; let steps = '', count = 0, pad = 0;
    for (const e of effects) if (e.type === 'drop-shadow') { const id = 'shadow' + count++, size = Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.spread) + e.blur * 2; pad = Math.max(pad, size); if (e.spread) steps += `<feMorphology in="SourceAlpha" operator="${e.spread > 0 ? 'dilate' : 'erode'}" radius="${Math.abs(e.spread)}" result="${id}-spread"/>`; steps += `<feGaussianBlur in="${e.spread ? id + '-spread' : 'SourceAlpha'}" stdDeviation="${e.blur / 2}" result="${id}-blur"/><feOffset in="${id}-blur" dx="${e.x}" dy="${e.y}" result="${id}-offset"/><feFlood flood-color="${escape(e.color)}" flood-opacity="${e.opacity}"/><feComposite in2="${id}-offset" operator="in" result="${id}"/>`; shadows.push(id); }
    if (shadows.length) steps += `<feMerge result="shadowed">${shadows.map(id => `<feMergeNode in="${id}"/>`).join('')}<feMergeNode in="SourceGraphic"/></feMerge>`;
    let input = shadows.length ? 'shadowed' : 'SourceGraphic';
    for (const e of effects) if (e.type === 'layer-blur') { const result = 'layer' + count++; steps += `<feGaussianBlur in="${input}" stdDeviation="${e.radius}" result="${result}"/>`; input = result; pad += e.radius * 3; }
    let filter = ''; if (steps) { const id = nextId(), ink = strokeBounds(n, r, points); pad = Math.max(1, pad); defs += `<filter id="${id}" filterUnits="userSpaceOnUse" x="${ink.x-pad}" y="${ink.y-pad}" width="${ink.w+pad*2}" height="${ink.h+pad*2}" color-interpolation-filters="sRGB">${steps}</filter>`; filter = ` filter="url(#${id})"`; }
    return `<g id="${escape(n.id)}" data-name="${escape(n.name)}"${alpha === 1 ? '' : ` opacity="${alpha}"`}${filter}>${defs ? `<defs>${defs}</defs>` : ''}${primitives}${nested}</g>`;
}
