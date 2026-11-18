import { nodeFills, type Node } from '../shared/doc';
import type { Rect } from '../shared/geometry';
import type { PathPoint } from '../shared/path';
import { pathArrows, strokeBounds, strokeStyle, strokeShadowCaster } from '../shared/stroke';
type SVGPaintOptions = { images?: ReadonlyMap<string, string>; backdrop?: string; region?: Rect; ownId?: string; points?: PathPoint[] };
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
            extra = `<defs><mask id="${id}" maskUnits="userSpaceOnUse" ${region}><rect ${region} fill="white"/><${tag} ${geometry} fill="black" fill-rule="evenodd"/></mask></defs><${tag} ${geometry} fill="none"${attrs} mask="url(#${id})"/>`;
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
    return { inline: align === 'center' ? attrs : '', extra, fillRule: align === 'center' ? '' : ' fill-rule="evenodd"' };
}

export function svgPaints(n: Node, r: Rect, tag: string, geometry: string, alpha: number, nested: string, nextId: () => string, content = '', options: SVGPaintOptions = {}) {
    let defs = '', primitives = '', drop = '', shadowReplay = '', background = '', previousBackground = '', interior = '', shapeClip = '';
    const stroke = options.points && svgStroke(n, r, tag, geometry, options.points, 1, nextId);
    const primitive = (attributes: string) => tag === 'text' ? `<text ${geometry} ${attributes}>${content}</text>` : `<${tag} ${geometry} ${attributes}/>`;
    const clipShape = () => { if (!shapeClip) { shapeClip = nextId(); defs += `<clipPath id="${shapeClip}" clipPathUnits="userSpaceOnUse">${primitive('fill="#000000"' + (stroke?.fillRule ? ' clip-rule="evenodd"' : ''))}</clipPath>`; } return `clip-path="url(#${shapeClip})"`; };
    for (const p of nodeFills(n)) if (p.visible && (n.type !== 'path' || n.closed)) {
        let fill: string;
        if (p.type === 'image') {
            const source = options.images?.get(p.asset); if (!source || !/^data:image\/(png|jpeg|webp|gif);base64,/.test(source)) throw Error('SVG image asset unavailable; use exportSVGWithAssets.');
            if (p.fit === 'tile') { const id = nextId(); defs += `<pattern id="${id}" patternUnits="userSpaceOnUse" x="${r.x}" y="${r.y}" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}"><image width="${p.w}" height="${p.h}" preserveAspectRatio="none" href="${escape(source)}"/></pattern>`; fill = `url(#${id})`; }
            else { const scale = (p.fit === 'fill' ? Math.max : Math.min)(r.w / p.w, r.h / p.h), w = p.w * scale, h = p.h * scale; primitives += `<image x="${r.x + (r.w - w) / 2}" y="${r.y + (r.h - h) / 2}" width="${w}" height="${h}" preserveAspectRatio="none" href="${escape(source)}" opacity="${p.opacity}" ${clipShape()}/>`; continue; }
        }
        else if (p.type === 'solid') fill = escape(p.color);
        else { const id = nextId(), radial = p.type === 'radial', gradientTag = radial ? 'radialGradient' : 'linearGradient', coordinates = radial ? `cx="${p.from.x}" cy="${p.from.y}" r="${Math.max(.000001, Math.hypot(p.to.x - p.from.x, p.to.y - p.from.y))}"` : `x1="${r.x + p.from.x * r.w}" y1="${r.y + p.from.y * r.h}" x2="${r.x + p.to.x * r.w}" y2="${r.y + p.to.y * r.h}"`; defs += `<${gradientTag} id="${id}" gradientUnits="${radial && tag !== 'text' ? 'objectBoundingBox' : 'userSpaceOnUse'}"${radial && tag === 'text' ? ` gradientTransform="matrix(${r.w} 0 0 ${r.h} ${r.x} ${r.y})"` : ''} ${coordinates}>${[...p.stops].sort((a,b) => a.pos-b.pos).map(s => `<stop offset="${s.pos}" stop-color="${escape(s.color)}" stop-opacity="${s.opacity}"/>`).join('')}</${gradientTag}>`; fill = `url(#${id})`; }
        primitives += primitive(`fill="${fill}" fill-opacity="${p.opacity}"${stroke?.fillRule ?? ''}`);
    }
    if (stroke) primitives += (stroke.inline ? primitive(`fill="none"${stroke.inline}`) : '') + stroke.extra;
    else if (n.stroke && n.strokeWidth > 0) primitives += primitive(`fill="none" stroke="${escape(n.stroke)}" stroke-width="${n.strokeWidth}"`);
    const effects = (n.effects ?? []).filter(e => e.visible && (n.type !== 'path' || n.closed || e.type !== 'inner-shadow' && e.type !== 'background-blur')), shadows: string[] = []; let steps = '', count = 0, pad = 0;
    const hasFill = (n.type !== 'path' || !!n.closed) && nodeFills(n).some(p => p.visible && p.opacity > 0 && (p.type !== 'linear' && p.type !== 'radial' || p.stops.some(s => s.opacity > 0))), hasStroke = !!n.stroke && n.strokeWidth > 0;
    const filterFor = (steps: string, margin: number) => { const id = nextId(), ink = strokeBounds(n, r, options.points); margin = Math.max(1, margin); defs += `<filter id="${id}" filterUnits="userSpaceOnUse" x="${ink.x - margin}" y="${ink.y - margin}" width="${ink.w + margin * 2}" height="${ink.h + margin * 2}" color-interpolation-filters="sRGB">${steps}</filter>`; return id; };
    for (const e of effects) if (e.type === 'drop-shadow' && (hasFill || hasStroke && strokeShadowCaster(n, e.spread).strokeWidth > 0)) { const id = 'shadow' + count++, size = Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.spread) + e.blur * 2; pad = Math.max(pad, size); if (e.spread) steps += `<feMorphology in="SourceAlpha" operator="${e.spread > 0 ? 'dilate' : 'erode'}" radius="${Math.abs(e.spread)}" result="${id}-spread"/>`; steps += `<feGaussianBlur in="${e.spread ? id + '-spread' : 'SourceAlpha'}" stdDeviation="${e.blur / 2}" result="${id}-blur"/><feOffset in="${id}-blur" dx="${e.x}" dy="${e.y}" result="${id}-offset"/><feFlood flood-color="${escape(e.color)}" flood-opacity="${e.opacity}"/><feComposite in2="${id}-offset" operator="in" result="${id}"/>`; shadows.push(id); }
    if (shadows.length) { steps += `<feMerge>${shadows.map(id => `<feMergeNode in="${id}"/>`).join('')}</feMerge>`; const id = filterFor(steps, pad), replay = nextId(), caster = options.points && !hasFill ? svgStroke({ ...n, stroke: '#000000' }, r, tag, geometry, options.points, 1, nextId) : undefined, silhouette = caster ? (caster.inline ? primitive(`fill="none"${caster.inline}`) : '') + caster.extra : primitive(hasFill ? 'fill="#000000"' : `fill="none" stroke="#000000" stroke-width="${n.strokeWidth}"`); drop = `<g id="${replay}" filter="url(#${id})">${silhouette}</g>`; shadowReplay = `<use href="#${replay}"/>`; }
    const layered = effects.some(e => e.type === 'layer-blur'), backdrop = (options.backdrop ?? '') + (layered ? '' : shadowReplay);
    for (const e of effects) if (e.type === 'background-blur' && backdrop) {
        const id = nextId(), replay = nextId(), region = options.region ?? r, margin = e.radius * 3;
        defs += `<filter id="${id}" filterUnits="userSpaceOnUse" x="${region.x - margin}" y="${region.y - margin}" width="${region.w + margin * 2}" height="${region.h + margin * 2}" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="${e.radius}"/></filter>`;
        background += `<g id="${replay}" ${clipShape()}><g filter="url(#${id})">${backdrop}${!layered && previousBackground ? `<use href="#${previousBackground}"/>` : ''}</g></g>`; previousBackground = replay;
    }
    for (const e of effects) if (e.type === 'inner-shadow') {
        const id = nextId(), margin = Math.max(1, Math.abs(e.x) + Math.abs(e.y) + Math.abs(e.spread) + e.blur * 2);
        defs += `<filter id="${id}" filterUnits="userSpaceOnUse" x="${r.x - margin}" y="${r.y - margin}" width="${r.w + margin * 2}" height="${r.h + margin * 2}" color-interpolation-filters="sRGB">${e.spread ? `<feMorphology in="SourceAlpha" operator="${e.spread > 0 ? 'erode' : 'dilate'}" radius="${Math.abs(e.spread)}" result="hole"/>` : ''}<feComponentTransfer in="${e.spread ? 'hole' : 'SourceAlpha'}" result="inverse"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feGaussianBlur in="inverse" stdDeviation="${e.blur / 2}"/><feOffset dx="${e.x}" dy="${e.y}" result="offset"/><feFlood flood-color="${escape(e.color)}" flood-opacity="${e.opacity}"/><feComposite in2="offset" operator="in"/><feComposite in2="SourceAlpha" operator="in"/></filter>`;
        interior += `<g ${clipShape()}>${primitive(`fill="#000000" filter="url(#${id})"`)}</g>`;
    }
    steps = ''; let input = 'SourceGraphic';
    for (const e of effects) if (e.type === 'layer-blur') { const result = 'layer' + count++; steps += `<feGaussianBlur in="${input}" stdDeviation="${e.radius}" result="${result}"/>`; input = result; pad += e.radius * 3; }
    const filter = steps ? ` filter="url(#${filterFor(steps, pad)})"` : '';
    const own = `${drop}${background}${primitives}${interior}`;
    return `<g id="${escape(n.id)}" data-name="${escape(n.name)}"${alpha === 1 ? '' : ` opacity="${alpha}"`}${filter}>${defs ? `<defs>${defs}</defs>` : ''}${options.ownId ? `<g id="${options.ownId}">${own}</g>` : own}${nested}</g>`;
}
