import { children, type Doc, type Node } from '../shared/doc';
import { bounds, world } from '../shared/geometry';
import { drawNode } from './draw';
import { blocked } from '../shared/layers';

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
    const r = bounds(roots.map(n => {
        const r = world(doc, n), pad = n.stroke && n.strokeWidth > 0 ? n.strokeWidth / 2 : 0;
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

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function exportSVG(doc: Doc, ids: Iterable<string>): string {
    const roots = exportRoots(doc, ids), r = exportBounds(doc, roots);
    let clip = 0;
    const render = (n: Node, alpha: number): string => {
        if (n.hidden)
            return '';
        if (n.type === 'group')
            return children(doc, n.id).map(child => render(child, alpha)).join('');
        const r = world(doc, n), opacity = alpha * n.opacity;
        const radius = Math.min(n.radius, r.w / 2, r.h / 2);
        const rect = `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"${radius ? ` rx="${radius}" ry="${radius}"` : ''}`;
        const geometry = n.type === 'ellipse' ? `cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}"` : rect;
        const tag = n.type === 'ellipse' ? 'ellipse' : 'rect';
        const primitive = `<${tag} id="${escape(n.id)}" data-name="${escape(n.name)}" ${geometry} fill="${escape(n.fill)}"${opacity === 1 ? '' : ` fill-opacity="${opacity}"`}${n.stroke && n.strokeWidth > 0 ? ` stroke="${escape(n.stroke)}" stroke-width="${n.strokeWidth}"${opacity === 1 ? '' : ` stroke-opacity="${opacity}"`}` : ''}/>`;
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
