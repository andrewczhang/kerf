import { nodeFills, type Node } from './doc';
import type { Point, Rect } from './geometry';

export interface Measurement { from: Point; to: Point; distance: number }
export function measurements(a: Rect, b: Rect): Measurement[] {
    const out: Measurement[] = [];
    const add = (x: number, y: number, tx: number, ty: number) => out.push({ from: { x, y }, to: { x: tx, y: ty }, distance: Math.round(Math.abs(tx - x) + Math.abs(ty - y)) });
    const axis = (start: number, end: number, otherStart: number, otherEnd: number, cross: number, vertical: boolean) => {
        const line = (a: number, b: number) => vertical ? add(cross, a, cross, b) : add(a, cross, b, cross);
        if (end <= otherStart) line(end, otherStart);
        else if (otherEnd <= start) line(otherEnd, start);
        else { line(start, otherStart); line(end, otherEnd); }
    };
    axis(a.x, a.x + a.w, b.x, b.x + b.w, (Math.max(a.y, b.y) + Math.min(a.y + a.h, b.y + b.h)) / 2, false);
    axis(a.y, a.y + a.h, b.y, b.y + b.h, (Math.max(a.x, b.x) + Math.min(a.x + a.w, b.x + b.w)) / 2, true);
    return out;
}

export function inspectCSS(node?: Node, size = node): string {
    if (!node || !size) return '';
    const px = (n: number) => `${Math.round(n * 100) / 100}px`;
    const properties: [string, string][] = [['position', 'absolute'], ['left', px(node.x)], ['top', px(node.y)], ['width', px(size.w)], ['height', px(size.h)]];
    const paint = nodeFills(node).filter(p => p.visible).at(-1);
    if (paint?.type === 'solid') properties.push([node.type === 'text' ? 'color' : 'background', paint.opacity === 1 ? paint.color : `rgb(${parseInt(paint.color.slice(1, 3), 16)} ${parseInt(paint.color.slice(3, 5), 16)} ${parseInt(paint.color.slice(5, 7), 16)} / ${paint.opacity})`]);
    if (node.stroke) properties.push(['border', `${px(node.strokeWidth)} solid ${node.stroke}`]);
    properties.push(['border-radius', node.type === 'ellipse' ? '50%' : px(node.radius)], ['opacity', String(node.opacity)]);
    if (node.type === 'text') {
        if (node.fontFamily) properties.push(['font-family', { sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace' }[node.fontFamily]]);
        if (node.fontSize !== undefined) properties.push(['font-size', px(node.fontSize)]);
        if (node.fontWeight !== undefined) properties.push(['font-weight', String(node.fontWeight)]);
        if (node.textAlign) properties.push(['text-align', node.textAlign]);
    }
    return properties.map(([key, value]) => `${key}: ${value};`).join('\n');
}
