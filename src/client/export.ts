import { children, nodeFills, isTextNode, type Doc, type Node } from '../shared/doc';
import { bounds } from '../shared/geometry';
import { world } from './geometry';
import { drawNode } from './draw';
import { loadAsset } from './assets';
import { svgPaints } from './svg-paints';
import { blocked } from '../shared/layers';
import { fontFamilies, measureTextNode, textPaintBounds } from './text-layout';
import { toAbs, trace, type PathPoint } from '../shared/path';

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
        let r = world(doc, n);
        if (isTextNode(n)) {
            const ink = textPaintBounds(n);
            r = { ...ink, x: r.x + ink.x, y: r.y + ink.y };
        }
        const pad = n.type !== 'group' && n.stroke && n.strokeWidth > 0 ? n.strokeWidth / 2 : 0;
        let left = pad, top = pad, right = pad, bottom = pad, blur = 0;
        for (const e of n.type === 'group' ? [] : n.effects ?? []) if (e.visible) { if (e.type === 'drop-shadow') { const size = Math.max(0, e.spread) + e.blur * 2; left = Math.max(left, size - e.x); top = Math.max(top, size - e.y); right = Math.max(right, size + e.x); bottom = Math.max(bottom, size + e.y); } else if (e.type === 'layer-blur') blur += e.radius * 3; }
        return { x: r.x - left - blur, y: r.y - top - blur, w: r.w + left + right + blur * 2, h: r.h + top + bottom + blur * 2 };
    }));
    const x = Math.floor(r.x), y = Math.floor(r.y);
    return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

function exportImages(doc: Doc, ids: Iterable<string>) {
    const images = new Set<string>(), collect = (n: Node) => { if (n.hidden) return; if (n.type !== 'group' && (n.type !== 'path' || n.closed)) for (const paint of nodeFills(n)) if (paint.visible && paint.type === 'image') images.add(paint.asset); if (n.type === 'frame' || n.type === 'group') children(doc, n.id).forEach(collect); };
    exportRoots(doc, ids).forEach(collect); return images;
}
const exportFile = () => typeof location === 'undefined' ? 'untitled' : location.pathname.split('/')[2] || 'untitled';
export async function exportSVGWithAssets(doc: Doc, ids: Iterable<string>): Promise<string> {
    const selection = [...ids], file = exportFile(), images = new Map<string, string>();
    await Promise.all([...exportImages(doc, selection)].map(async hash => {
        const response = await fetch(`/f/${encodeURIComponent(file)}/assets/${hash}`); if (!response.ok) throw Error('Asset unavailable');
        const blob = await response.blob(); if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw Error('Unsupported image asset');
        const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        images.set(hash, `data:${blob.type};base64,${btoa(binary)}`);
    }));
    return exportSVG(doc, selection, images);
}

export async function exportPNG(doc: Doc, ids: Iterable<string>, scale: number): Promise<Blob> {
    const roots = exportRoots(doc, ids), r = exportBounds(doc, roots);
    if (!roots.length || !Number.isFinite(scale) || scale <= 0)
        throw new Error('Select objects and use a positive export scale.');
    const file = exportFile(); await Promise.all([...exportImages(doc, roots.map(n => n.id))].map(hash => loadAsset(file, hash)));
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

export function exportSVG(doc: Doc, ids: Iterable<string>, images: ReadonlyMap<string, string> = new Map()): string {
    const roots = exportRoots(doc, ids), r = exportBounds(doc, roots);
    let clip = 0, paint = 0;
    const paintId = () => { let id: string; do { id = `paint-${paint++}`; } while (doc.has(id)); return id; };
    const renderList = (nodes: Node[], alpha: number, backdrop: string): string => {
        let output = '', below = backdrop;
        for (const n of nodes) { if (n.hidden) continue; const id = paintId(), rendered = render(n, alpha, below); output += `<g id="${id}">${rendered}</g>`; below += `<use href="#${id}"/>`; }
        return output;
    };
    const render = (n: Node, alpha: number, backdrop: string): string => {
        if (n.hidden)
            return '';
        if (n.type === 'group')
            return renderList(children(doc, n.id), alpha, backdrop);
        const r = world(doc, n), opacity = alpha * n.opacity;
        if (isTextNode(n)) {
            const { lines, leading, baseline, offset } = measureTextNode(n);
            const anchor = n.textAlign === 'left' ? 'start' : n.textAlign === 'center' ? 'middle' : 'end';
            const runs = lines.map((line, i) => `<tspan x="${r.x + offset}" y="${r.y + baseline + i * leading}">${escape(line)}</tspan>`).join('');
            if (n.fills !== undefined || n.effects !== undefined) return svgPaints(n, r, 'text', `xml:space="preserve" font-family="${fontFamilies[n.fontFamily]}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" text-anchor="${anchor}"`, opacity, '', paintId, runs, { images, backdrop, region: r });
            return `<text id="${escape(n.id)}" data-name="${escape(n.name)}" xml:space="preserve" fill="${escape(n.fill)}" fill-opacity="${opacity}" font-family="${fontFamilies[n.fontFamily]}" font-size="${n.fontSize}" font-weight="${n.fontWeight}" text-anchor="${anchor}">${runs}</text>`;
        }
        const radius = Math.min(n.radius, r.w / 2, r.h / 2);
        const rect = `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"${radius ? ` rx="${radius}" ry="${radius}"` : ''}`;
        const geometry = n.type === 'path' ? `d="${pathData(toAbs(n.points ?? [], r), !!n.closed)}" stroke-linejoin="round" stroke-linecap="round"` : n.type === 'ellipse' ? `cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}"` : rect;
        const tag = n.type === 'ellipse' ? 'ellipse' : n.type === 'path' ? 'path' : 'rect';
        if (n.fills !== undefined || n.effects !== undefined) {
            let nested = '', ownId: string | undefined;
            if (n.type === 'frame') { let id: string; do { id = `clip-${clip++}`; } while (doc.has(id)); ownId = paintId(); nested = `<defs><clipPath id="${id}"><rect ${rect}/></clipPath></defs><g clip-path="url(#${id})">${renderList(children(doc, n.id), 1, backdrop + `<use href="#${ownId}" opacity="${opacity}"/>`)}</g>`; }
            return svgPaints(n, r, tag, geometry, opacity, nested, paintId, '', { images, backdrop, region: r, ownId });
        }
        const primitive = `<${tag} id="${escape(n.id)}" data-name="${escape(n.name)}" ${geometry}${n.type === 'path' && !n.closed ? ' fill="none"' : ` fill="${escape(n.fill)}"${opacity === 1 ? '' : ` fill-opacity="${opacity}"`}`}${n.stroke && n.strokeWidth > 0 ? ` stroke="${escape(n.stroke)}" stroke-width="${n.strokeWidth}"${opacity === 1 ? '' : ` stroke-opacity="${opacity}"`}` : ''}/>`;
        if (n.type !== 'frame')
            return primitive;
        let id: string;
        do { id = `clip-${clip++}`; } while (doc.has(id));
        const ownId = paintId();
        return `<g id="${ownId}">${primitive}</g><defs><clipPath id="${id}"><rect ${rect}/></clipPath></defs><g clip-path="url(#${id})">${renderList(children(doc, n.id), opacity, backdrop + `<use href="#${ownId}"/>`)}</g>`;
    };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r.x} ${r.y} ${r.w} ${r.h}" width="${r.w}" height="${r.h}">${renderList(roots, 1, '')}</svg>`;
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
    const blob = format === 'svg' ? new Blob([await exportSVGWithAssets(doc, selection)], { type: 'image/svg+xml' }) : await exportPNG(doc, selection, scale);
    download(blob, filename);
}
