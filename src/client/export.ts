import { children, isTextNode, type Doc, type Node } from '../shared/doc';
import { bounds } from '../shared/geometry';
import { world } from './geometry';
import { drawNode } from './draw';
import { fontFamilies, measureTextNode, textPaintBounds } from './text-layout';
import { contoursAbs, trace, type PathPoint } from '../shared/path';

export function exportRoots(doc: Doc, ids: Iterable<string>): Node[] {
    const selected = new Set(ids), roots: Node[] = [];
    const walk = (parent: string | null, ancestorSelected: boolean) => {
        for (const n of children(doc, parent)) {
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
    const r = bounds(roots.map(n => {
        const r = world(doc, n);
        if (isTextNode(n)) {
            const ink = textPaintBounds(n);
            return { ...ink, x: r.x + ink.x, y: r.y + ink.y };
        }
        const pad = n.stroke && n.strokeWidth > 0 ? n.strokeWidth / 2 : 0;
        return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    }));
    const x = Math.floor(r.x), y = Math.floor(r.y);
    return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

export async function exportPNG(doc: Doc, ids: Iterable<string>, scale: number): Promise<Blob> {
    const roots = exportRoots(doc, ids), r = exportBounds(doc, roots);
    if (!roots.length || !Number.isFinite(scale) || scale <= 0)
        throw new Error('Select objects and use a positive export scale.');
    const canvas = document.createElement('canvas');
    canvas.width = r.w * scale;
    canvas.height = r.h * scale;
    const c = canvas.getContext('2d');
    if (!c)
        throw new Error('Canvas rendering is unavailable.');
    c.scale(scale, scale);
    c.translate(-r.x, -r.y);
    for (const n of roots)
        drawNode(c, doc, n, { zoom: scale, labels: false });
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
    let clip = 0;
    const render = (n: Node, alpha: number): string => {
        const r = world(doc, n), opacity = alpha * n.opacity;
        if (isTextNode(n)) {
            const { lines, leading, baseline, offset } = measureTextNode(n);
            const anchor = n.textAlign === 'left' ? 'start' : n.textAlign === 'center' ? 'middle' : 'end';
            const runs = lines.map((line, i) => `<tspan x="${r.x + offset}" y="${r.y + baseline + i * leading}">${escape(line)}</tspan>`).join('');
            return `<text id="${escape(n.id)}" data-name="${escape(n.name)}" xml:space="preserve" fill="${escape(n.fill)}" fill-opacity="${opacity}" font-family="${fontFamilies[n.fontFamily]}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" text-anchor="${anchor}">${runs}</text>`;
        }
        const radius = Math.min(n.radius, r.w / 2, r.h / 2);
        const rect = `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"${radius ? ` rx="${radius}" ry="${radius}"` : ''}`;
        const geometry = n.type === 'path' ? `d="${contoursAbs(n, r).map((abs, i) => pathData(abs, i > 0 || !!n.closed)).join('')}"${n.contours?.length ? ' fill-rule="evenodd"' : ''} stroke-linejoin="round" stroke-linecap="round"` : n.type === 'ellipse' ? `cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}"` : rect;
        const tag = n.type === 'ellipse' ? 'ellipse' : n.type === 'path' ? 'path' : 'rect';
        const primitive = `<${tag} id="${escape(n.id)}" data-name="${escape(n.name)}" ${geometry}${n.type === 'path' && !n.closed ? ' fill="none"' : ` fill="${escape(n.fill)}"${opacity === 1 ? '' : ` fill-opacity="${opacity}"`}`}${n.stroke && n.strokeWidth > 0 ? ` stroke="${escape(n.stroke)}" stroke-width="${n.strokeWidth}"${opacity === 1 ? '' : ` stroke-opacity="${opacity}"`}` : ''}/>`;
        if (n.type !== 'frame')
            return primitive;
        let id: string;
        do { id = `clip-${clip++}`; } while (doc.has(id));
        return `${primitive}<defs><clipPath id="${id}"><rect ${rect}/></clipPath></defs><g clip-path="url(#${id})">${children(doc, n.id).map(child => render(child, opacity)).join('')}</g>`;
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
