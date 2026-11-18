import { children, nodeFills, isTextNode, type Doc, type Node } from '../shared/doc';
import { bounds, inverse, multiply, transformedBounds, type Mat } from '../shared/geometry';
import { world, worldMatrix } from './geometry';
import { drawNode } from './draw';
import { loadAsset } from './assets';
import { svgPaints, svgStroke } from './svg-paints';
import { blocked } from '../shared/layers';
import { fontFamilies, measureTextNode, textPaintBounds } from './text-layout';
import { toAbs, trace, type PathPoint } from '../shared/path';
import { arrowBounds, strokeBounds, strokeShadowCaster } from '../shared/stroke';

export function exportRoots(doc: Doc, ids: Iterable<string>): Node[] {
    const selected = new Set(ids), roots: Node[] = [];
    const walk = (parent: string | null, ancestorSelected: boolean) => {
        for (const n of children(doc, parent)) {
            if (blocked(doc, n, false))
                continue;
            const included = selected.has(n.id);
            if (included && !ancestorSelected)
                roots.push(n);
            walk(n.id, ancestorSelected || included);
        }
    };
    walk(null, false);
    return roots;
}

export function exportBounds(doc: Doc, roots: Node[]) {
    const visible: Node[] = [], collect = (n: Node) => { if (blocked(doc, n, false)) return; if (n.type === 'group') { const cs = children(doc, n.id).filter(c => !c.hidden); if (cs.length) cs.forEach(collect); else visible.push(n); } else visible.push(n); };
    roots.forEach(collect);
    const r = bounds(visible.map(n => {
        let r = { x: 0, y: 0, w: n.w, h: n.h };
        if (isTextNode(n)) {
            const ink = textPaintBounds(n);
            r = ink;
        }
        const points = n.type === 'path' ? toAbs(n.points ?? [], r) : [];
        if (n.type !== 'group')
            r = strokeBounds(n, r, points);
        let left = 0, top = 0, right = 0, bottom = 0, blur = 0;
        for (const e of n.type === 'group' ? [] : n.effects ?? []) if (e.visible) {
            if (e.type === 'drop-shadow') {
                const feather = e.blur * 2, size = Math.max(0, e.spread) + feather;
                left = Math.max(left, size - e.x); top = Math.max(top, size - e.y);
                right = Math.max(right, size + e.x); bottom = Math.max(bottom, size + e.y);
                if (e.spread > 0 && n.stroke && n.strokeWidth > 0) {
                    for (const arrow of arrowBounds(strokeShadowCaster(n, e.spread), points)) {
                        left = Math.max(left, r.x - arrow.x - e.x + feather);
                        top = Math.max(top, r.y - arrow.y - e.y + feather);
                        right = Math.max(right, arrow.x + arrow.w + e.x + feather - r.x - r.w);
                        bottom = Math.max(bottom, arrow.y + arrow.h + e.y + feather - r.y - r.h);
                    }
                }
            } else if (e.type === 'layer-blur') blur += e.radius * 3;
        }
        return transformedBounds(worldMatrix(doc, n), { x: r.x - left - blur, y: r.y - top - blur, w: r.w + left + right + blur * 2, h: r.h + top + bottom + blur * 2 });
    }));
    const x = Math.floor(r.x), y = Math.floor(r.y);
    return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

export async function exportPNG(doc: Doc, ids: Iterable<string>, scale: number): Promise<Blob> {
    const roots = exportRoots(doc, ids), r = exportBounds(doc, roots);
    if (!roots.length || !Number.isFinite(scale) || scale <= 0)
        throw new Error('Select objects and use a positive export scale.');
    const file = typeof location === 'undefined' ? 'untitled' : location.pathname.split('/')[2] || 'untitled', images = new Set<string>();
    const collect = (n: Node) => { if (n.hidden) return; if (n.type !== 'group') for (const paint of nodeFills(n)) if (paint.visible && paint.type === 'image') images.add(paint.asset); if (n.type === 'frame' || n.type === 'group') for (const child of children(doc, n.id)) collect(child); };
    roots.forEach(collect); await Promise.all([...images].map(hash => loadAsset(file, hash)));
    const canvas = document.createElement('canvas');
    canvas.width = r.w * scale;
    canvas.height = r.h * scale;
    const c = canvas.getContext('2d');
    if (!c)
        throw new Error('Canvas rendering is unavailable.');
    c.scale(scale, scale);
    c.translate(-r.x, -r.y);
    for (const n of roots)
        drawNode(c, doc, n, { zoom: scale, scale, labels: false, file });
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
}

/** SVG path data for a world-space path. */
export function pathData(abs: PathPoint[], closed: boolean): string {
    const out: string[] = [];
    trace({ moveTo: (x, y) => out.push(`M${x} ${y}`), bezierCurveTo: (a, b, c, d, e, f) => out.push(`C${a} ${b} ${c} ${d} ${e} ${f}`), closePath: () => out.push('Z') }, abs, closed);
    return out.join('');
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function exportSVG(doc: Doc, ids: Iterable<string>): string {
    const roots = exportRoots(doc, ids), r = exportBounds(doc, roots);
    let clip = 0, paint = 0;
    const paintId = () => { let id: string; do { id = `paint-${paint++}`; } while (doc.has(id)); return id; };
    const clipId = () => {
        let id: string;
        do { id = `clip-${clip++}`; } while (doc.has(id));
        return id;
    };
    const render = (n: Node, alpha: number, applied?: Mat): string => {
        if (n.hidden)
            return '';
        if (n.type === 'group')
            return children(doc, n.id).map(child => render(child, alpha, applied)).join('');
        const r = world(doc, n), opacity = alpha * n.opacity, m = worldMatrix(doc, n);
        const correction: Mat = [m[0], m[1], m[2], m[3], m[4] - m[0] * r.x - m[2] * r.y, m[5] - m[1] * r.x - m[3] * r.y];
        const relative = applied ? multiply(inverse(applied), correction) : correction;
        const transform = relative.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > 1e-10) ? ` transform="matrix(${relative.join(' ')})"` : '';
        if (isTextNode(n)) {
            const { lines, leading, baseline, offset } = measureTextNode(n);
            const anchor = n.textAlign === 'left' ? 'start' : n.textAlign === 'center' ? 'middle' : 'end';
            const runs = lines.map((line, i) => `<tspan x="${r.x + offset}" y="${r.y + baseline + i * leading}">${escape(line)}</tspan>`).join('');
            if (n.fills !== undefined || n.effects !== undefined) { const painted = svgPaints(n, r, 'text', `xml:space="preserve" font-family="${fontFamilies[n.fontFamily]}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" text-anchor="${anchor}"`, opacity, '', paintId, runs); return transform ? `<g${transform}>${painted}</g>` : painted; }
            return `<text id="${escape(n.id)}" data-name="${escape(n.name)}"${transform} xml:space="preserve" fill="${escape(n.fill)}" fill-opacity="${opacity}" font-family="${fontFamilies[n.fontFamily]}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" text-anchor="${anchor}">${runs}</text>`;
        }
        const radius = Math.min(n.radius, r.w / 2, r.h / 2);
        const rect = `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"${radius ? ` rx="${radius}" ry="${radius}"` : ''}`;
        const points = n.type === 'path' ? toAbs(n.points ?? [], r) : [];
        const geometry = n.type === 'path' ? `d="${pathData(points, !!n.closed)}"` : n.type === 'ellipse' ? `cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}"` : rect;
        const tag = n.type === 'ellipse' ? 'ellipse' : n.type === 'path' ? 'path' : 'rect';
        if (n.fills !== undefined || n.effects !== undefined) {
            let nested = '';
            if (n.type === 'frame') { const id = clipId(); nested = `<defs><clipPath id="${id}"><rect ${rect}/></clipPath></defs><g clip-path="url(#${id})">${children(doc, n.id).map(child => render(child, 1, correction)).join('')}</g>`; }
            const painted = svgPaints(n, r, tag, geometry, opacity, nested, paintId, '', points);
            return transform ? `<g${transform}>${painted}</g>` : painted;
        }
        const stroke = svgStroke(n, r, tag, geometry, points, opacity, clipId);
        const fill = n.type === 'path' && !n.closed ? ' fill="none"' : ` fill="${escape(n.fill)}"${opacity === 1 ? '' : ` fill-opacity="${opacity}"`}${stroke.fillRule}`;
        const primitive = `<${tag} id="${escape(n.id)}" data-name="${escape(n.name)}" ${geometry}${fill}${stroke.inline}/>${stroke.extra}`;
        const rotated = transform ? `<g${transform}>${primitive}</g>` : primitive;
        if (n.type !== 'frame')
            return rotated;
        const id = clipId();
        return `${rotated}<defs><clipPath id="${id}"><rect${transform} ${rect}/></clipPath></defs><g clip-path="url(#${id})">${children(doc, n.id).map(child => render(child, opacity, applied)).join('')}</g>`;
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r.x} ${r.y} ${r.w} ${r.h}" width="${r.w}" height="${r.h}">${roots.map(n => render(n, 1)).join('')}</svg>`;
}

export function exportFilename(doc: Doc, ids: Iterable<string>, format: 'png' | 'svg', scale = 1): string {
    const roots = exportRoots(doc, ids);
    const name = (roots.length === 1 ? roots[0].name : 'Export').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim() || 'Export';
    return `${name}${format === 'png' && scale === 2 ? '@2x' : ''}.${format}`;
}

export function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function downloadSelection(doc: Doc, ids: Iterable<string>, format: 'png' | 'svg', scale = 1) {
    const selection = [...ids];
    if (!exportRoots(doc, selection).length)
        return;
    const filename = exportFilename(doc, selection, format, scale);
    const blob = format === 'svg' ? new Blob([exportSVG(doc, selection)], { type: 'image/svg+xml' }) : await exportPNG(doc, selection, scale);
    download(blob, filename);
}
