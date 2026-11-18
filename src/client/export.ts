import { childIndex, nodeFills, isTextNode, type Doc, type Node } from '../shared/doc';
import { ancestorMasks, bounds, inverse, multiply, transformedBounds, type Mat } from '../shared/geometry';
import { world, worldMatrix } from './geometry';
import { clipMask, drawNode } from './draw';
import { expand } from '../shared/components';
import { loadAsset } from './assets';
import { svgPaints, svgStroke } from './svg-paints';
import { blocked } from '../shared/layers';
import { fontFamilies, measureTextNode, textPaintBounds } from './text-layout';
import { toAbs, trace, type PathPoint } from '../shared/path';
import { arrowBounds, strokeBounds, strokeShadowCaster } from '../shared/stroke';

export function exportRoots(doc: Doc, ids: Iterable<string>, tree = childIndex(doc)): Node[] {
    const selected = new Set(ids), roots: Node[] = [];
    const walk = (parent: string | null, ancestorSelected: boolean) => {
        for (const n of tree.get(parent) ?? []) {
            if (blocked(doc, n, false)) continue;
            const included = selected.has(n.id);
            if (included && !ancestorSelected)
                roots.push(n);
            walk(n.id, ancestorSelected || included);
        }
    };
    walk(null, false);
    return roots;
}

export function exportBounds(doc: Doc, roots: Node[], tree = childIndex(doc)) {
    const visible: Node[] = [], collect = (n: Node) => { if (blocked(doc, n, false)) return; if (n.mask) { if (roots.some(root => root.id === n.id) || (tree.get(n.parent) ?? []).some(s => !s.hidden && ancestorMasks(doc, s).some(m => m.id === n.id))) visible.push(n); return; } if (n.type === 'group') { const cs = (tree.get(n.id) ?? []).filter(c => !c.hidden); if (cs.length) cs.forEach(collect); else visible.push(n); } else visible.push(n); };
    roots.forEach(collect);
    const r = bounds(visible.map(n => {
        let r = { x: 0, y: 0, w: n.w, h: n.h };
        if (isTextNode(n)) {
            const ink = textPaintBounds(n);
            r = ink;
        }
        const points = n.type === 'path' ? toAbs(n.points ?? [], r) : [];
        if (!n.mask && n.type !== 'group')
            r = strokeBounds(n, r, points);
        let left = 0, top = 0, right = 0, bottom = 0, blur = 0;
        for (const e of n.mask || n.type === 'group' ? [] : n.effects ?? []) if (e.visible) {
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
        let result = transformedBounds(worldMatrix(doc, n), { x: r.x - left - blur, y: r.y - top - blur, w: r.w + left + right + blur * 2, h: r.h + top + bottom + blur * 2 });
        for (const mask of ancestorMasks(doc, n)) { const m = transformedBounds(worldMatrix(doc, mask), { x: 0, y: 0, w: mask.w, h: mask.h }), x = Math.max(result.x, m.x), y = Math.max(result.y, m.y); result = { x, y, w: Math.max(0, Math.min(result.x + result.w, m.x + m.w) - x), h: Math.max(0, Math.min(result.y + result.h, m.y + m.h) - y) }; }
        return result;
    }).filter(r => r.w > 0 && r.h > 0));
    const x = Math.floor(r.x), y = Math.floor(r.y);
    return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y };
}

function exportImages(doc: Doc, ids: Iterable<string>) {
    doc = expand(doc);
    const tree = childIndex(doc);
    const images = new Set<string>(), collect = (n: Node) => { if (n.hidden) return; if (n.type !== 'group' && (n.type !== 'path' || n.closed)) for (const paint of nodeFills(n)) if (paint.visible && paint.type === 'image') images.add(paint.asset); if (n.type === 'frame' || n.type === 'group') (tree.get(n.id) ?? []).forEach(collect); };
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
    doc = expand(doc);
    const tree = childIndex(doc), roots = exportRoots(doc, ids, tree), r = exportBounds(doc, roots);
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
    for (const n of roots) { c.save(); for (const mask of ancestorMasks(doc, n)) clipMask(c, doc, mask); drawNode(c, doc, n, { zoom: scale, scale, labels: false, file, tree }); c.restore(); }
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed.')), 'image/png'));
}

/** SVG path data for a world-space path. */
export function pathData(abs: PathPoint[], closed: boolean): string {
    const out: string[] = [];
    trace({ moveTo: (x, y) => out.push(`M${x} ${y}`), bezierCurveTo: (a, b, c, d, e, f) => out.push(`C${a} ${b} ${c} ${d} ${e} ${f}`), closePath: () => out.push('Z') }, abs, closed);
    return out.join('');
}

const escape = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function exportSVG(doc: Doc, ids: Iterable<string>, images: ReadonlyMap<string, string> = new Map()): string {
    doc = expand(doc);
    const tree = childIndex(doc), roots = exportRoots(doc, ids, tree), r = exportBounds(doc, roots, tree);
    const masksByNode = new Map<string, Node>();
    for (const siblings of tree.values()) {
        let mask: Node | undefined;
        for (const n of siblings) {
            if (n.mask && !n.hidden) mask = n;
            else if (mask) masksByNode.set(n.id, mask);
        }
    }
    const parentMasks = (n: Node) => {
        const masks: Node[] = [], seen = new Set<string>(); let current: Node | undefined = n;
        while (current && !seen.has(current.id)) {
            seen.add(current.id); const mask = masksByNode.get(current.id); if (mask) masks.push(mask);
            current = current.parent ? doc.get(current.parent) : undefined;
        }
        return masks;
    };
    type Clip = { id: string; applied?: Mat };
    const matrix = (m?: Mat) => m && m.some((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) > 1e-10) ? ` transform="matrix(${m.join(' ')})"` : '';
    const wrapped = (content: string, m?: Mat) => content && matrix(m) ? `<g${matrix(m)}>${content}</g>` : content;
    let clip = 0, paint = 0;
    const needsBackdrop = (nodes: Node[]): boolean => nodes.some(n => !n.hidden && ((n.type !== 'path' || n.closed) && n.effects?.some(e => e.visible && e.type === 'background-blur') || (n.type === 'frame' || n.type === 'group') && needsBackdrop((tree.get(n.id) ?? []))));
    const hasBackdrop = needsBackdrop(roots);
    const paintId = () => { let id: string; do { id = `paint-${paint++}`; } while (doc.has(id)); return id; };
    const clipId = () => { let id: string; do { id = `clip-${clip++}`; } while (doc.has(id)); return id; };
    const definitions: string[] = [], plainIds = new Map<string, string>();
    const plainRef = (n: Node, alpha: number, shell = false): string => {
        const key = `${n.id}/${alpha}/${shell}`; let id = plainIds.get(key);
        if (!id) { id = paintId(); plainIds.set(key, id); const content = render(n, alpha, '', true, shell); definitions.push(`<g id="${id}">${content}</g>`); }
        return `<use href="#${id}"/>`;
    };
    const extendBackdrop = (below: string, content: string) => { const id = paintId(); definitions.push(`<g id="${id}">${below}${content}</g>`); return `<use href="#${id}"/>`; };
    const clipped = (content: string, clips: Clip[]) => clips.reduceRight((body, clip) => wrapped(`<g clip-path="url(#${clip.id})">${wrapped(body, clip.applied && inverse(clip.applied))}</g>`, clip.applied), content);
    const renderList = (nodes: Node[], alpha: number, backdrop: string, plain = false, clips: Clip[] = [], applied?: Mat, roots = false): string => {
        let output = '', below = backdrop;
        for (const n of nodes) {
            if (n.hidden || n.mask) continue;
            const siblingMask = masksByNode.get(n.id), scopeMasks = roots ? parentMasks(n) : siblingMask ? [siblingMask] : [];
            const masks = scopeMasks.map(mask => {
                let id: string; do { id = `mask-${clip++}`; } while (doc.has(id));
                const r = { x: 0, y: 0, w: mask.w, h: mask.h }, m = worldMatrix(doc, mask), relative = applied ? multiply(inverse(applied), m) : m;
                const shape = mask.type === 'ellipse' ? `<ellipse cx="${r.w / 2}" cy="${r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}"` : mask.type === 'path' ? `<path d="${pathData(toAbs(mask.points ?? [], r), true)}"` : `<rect x="0" y="0" width="${r.w}" height="${r.h}" rx="${Math.min(mask.radius, r.w / 2, r.h / 2)}"`;
                definitions.push(`<clipPath id="${id}">${shape}${matrix(relative)}/></clipPath>`);
                return { id, applied };
            });
            const allClips = [...clips, ...masks], wrap = (body: string) => masks.reduce((content, mask) => `<g clip-path="url(#${mask.id})">${content}</g>`, body);
            if (!plain && !hasBackdrop) { output += wrap(render(n, alpha, '', false, false, allClips, applied)); continue; }
            const original = plainRef(n, alpha);
            if (plain) output += wrap(wrapped(original, applied && inverse(applied)));
            else { output += wrap(render(n, alpha, below, false, false, allClips, applied)); below = extendBackdrop(below, clipped(original, allClips)); }
        }
        return output;
    };
    const render = (n: Node, alpha: number, backdrop: string, plain = false, shell = false, clips: Clip[] = [], applied?: Mat): string => {
        if (n.hidden || n.mask)
            return '';
        if (n.type === 'group')
            return renderList((tree.get(n.id) ?? []), alpha, backdrop, plain, clips, applied);
        const raw = world(doc, n), r = { x: number(raw.x), y: number(raw.y), w: number(raw.w), h: number(raw.h) }, opacity = alpha * number(n.opacity), m = worldMatrix(doc, n);
        const correction: Mat = [m[0], m[1], m[2], m[3], m[4] - m[0] * r.x - m[2] * r.y, m[5] - m[1] * r.x - m[3] * r.y];
        const relative = applied ? multiply(inverse(applied), correction) : correction, transform = matrix(relative), localBackdrop = wrapped(backdrop, inverse(correction));
        const painted = plain ? { ...n, id: paintId(), effects: n.effects?.filter(e => e.type !== 'background-blur' && (!shell || e.type !== 'layer-blur')) } : n, nodeId = plain ? painted.id : n.id;
        if (isTextNode(n)) {
            const { lines, leading, baseline, offset } = measureTextNode(n);
            const anchor = n.textAlign === 'left' ? 'start' : n.textAlign === 'center' ? 'middle' : 'end';
            const runs = lines.map((line, i) => `<tspan x="${number(r.x + offset)}" y="${number(r.y + baseline + i * leading)}">${escape(line)}</tspan>`).join('');
            if (n.fills !== undefined || n.effects !== undefined) return wrapped(svgPaints(painted, r, 'text', `xml:space="preserve" font-family="${escape(fontFamilies[n.fontFamily])}" font-size="${number(n.fontSize)}" font-weight="${number(n.fontWeight)}" text-anchor="${anchor}"`, opacity, '', paintId, runs, { images, backdrop: localBackdrop, region: r }), relative);
            return `<text id="${escape(nodeId)}" data-name="${escape(n.name)}"${transform} xml:space="preserve" fill="${escape(n.fill)}" fill-opacity="${opacity}" font-family="${escape(fontFamilies[n.fontFamily])}" font-size="${number(n.fontSize)}" font-weight="${number(n.fontWeight)}" text-anchor="${anchor}">${runs}</text>`;
        }
        const radius = Math.min(n.radius, r.w / 2, r.h / 2);
        const rect = `x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"${radius ? ` rx="${radius}" ry="${radius}"` : ''}`;
        const points = n.type === 'path' ? toAbs(n.points ?? [], r) : [];
        const geometry = n.type === 'path' ? `d="${escape(pathData(points, !!n.closed))}"` : n.type === 'ellipse' ? `cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}"` : rect;
        const tag = n.type === 'ellipse' ? 'ellipse' : n.type === 'path' ? 'path' : 'rect';
        if (n.fills !== undefined || n.effects !== undefined) {
            let nested = '';
            if (n.type === 'frame' && !shell) { const id = clipId(); nested = `<defs><clipPath id="${id}"><rect ${rect}/></clipPath></defs><g clip-path="url(#${id})">${renderList((tree.get(n.id) ?? []), 1, plain || !hasBackdrop ? '' : extendBackdrop(backdrop, clipped(plainRef(n, alpha, true), clips)), plain, [...clips, { id, applied: correction }], correction)}</g>`; }
            return wrapped(svgPaints(painted, r, tag, geometry, opacity, nested, paintId, '', { images, backdrop: localBackdrop, region: r, points }), relative);
        }
        const stroke = svgStroke({ ...painted, strokeWidth: number(painted.strokeWidth) }, r, tag, geometry, points, opacity, clipId);
        const primitive = `<${tag} id="${escape(nodeId)}" data-name="${escape(n.name)}" ${geometry}${n.type === 'path' && !n.closed ? ' fill="none"' : ` fill="${escape(n.fill)}"${opacity === 1 ? '' : ` fill-opacity="${opacity}"`}${stroke.fillRule}`}${stroke.inline}/>${stroke.extra}`;
        if (n.type !== 'frame' || shell)
            return wrapped(primitive, relative);
        const id = clipId();
        return `${wrapped(primitive, relative)}<defs><clipPath id="${id}"><rect${transform} ${rect}/></clipPath></defs><g clip-path="url(#${id})">${renderList((tree.get(n.id) ?? []), opacity, plain || !hasBackdrop ? '' : extendBackdrop(backdrop, clipped(plainRef(n, alpha, true), clips)), plain, [...clips, { id, applied }], applied)}</g>`;
    };
    const content = renderList(roots, 1, '', false, [], undefined, true);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r.x} ${r.y} ${r.w} ${r.h}" width="${r.w}" height="${r.h}">${definitions.length ? `<defs>${definitions.join('')}</defs>` : ''}${content}</svg>`;
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
    doc = expand(doc);
    const selection = [...ids];
    if (!exportRoots(doc, selection).length)
        return;
    const filename = exportFilename(doc, selection, format, scale);
    const blob = format === 'svg' ? new Blob([await exportSVGWithAssets(doc, selection)], { type: 'image/svg+xml' }) : await exportPNG(doc, selection, scale);
    download(blob, filename);
}
