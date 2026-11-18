import type { TextNode } from '../shared/doc';

export const fontFamilies = {
    sans: 'Arial, sans-serif',
    serif: 'Georgia, serif',
    mono: 'monospace',
};
export const lineHeight = (node: TextNode) => node.fontSize * 1.2;
export const font = (node: TextNode) => `${node.fontWeight} ${node.fontSize}px ${fontFamilies[node.fontFamily]}`;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function wrap(paragraph: string, width: number, measure: (text: string) => number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const part of paragraph.match(/ +|[^ ]+/gu) ?? []) {
        if (part.startsWith(' ')) {
            line += part;
            continue;
        }
        if (line && measure(line + part) > width) {
            lines.push(line.trimEnd());
            line = '';
        }
        if (measure(part) <= width) {
            line += part;
            continue;
        }
        for (const { segment } of graphemes.segment(part)) {
            if (line && measure(line + segment) > width) {
                lines.push(line);
                line = '';
            }
            line += segment;
        }
    }
    lines.push(line.trimEnd());
    return lines;
}

export function layoutText(node: TextNode, measure: (text: string) => number) {
    const paragraphs = node.text.replaceAll('\t', '    ').split(/\r\n?|\n/);
    const fixed = node.textWidth === 'fixed';
    const lines = fixed ? paragraphs.flatMap(p => wrap(p, node.w, measure)) : paragraphs;
    const w = fixed ? node.w : Math.max(1, ...lines.map(measure));
    return { lines, w, h: lines.length * lineHeight(node), leading: lineHeight(node) };
}

const layouts = new WeakMap<TextNode, ReturnType<typeof layoutText> & { baseline: number; offset: number }>();
let meter: CanvasRenderingContext2D | undefined;
const getMeter = () => meter ??= document.createElement('canvas').getContext('2d')!;
export function measureTextNode(node: TextNode) {
    let layout = layouts.get(node);
    if (!layout) {
        const c = getMeter();
        c.font = font(node);
        const box = layoutText(node, line => c.measureText(line).width);
        const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = c.measureText('');
        const baseline = Number.isFinite(ascent + descent) ? (box.leading + ascent - descent) / 2 : node.fontSize;
        const offset = node.textAlign === 'center' ? box.w / 2 : node.textAlign === 'right' ? box.w : 0;
        layout = { ...box, baseline, offset };
        layouts.set(node, layout);
    }
    return layout;
}

export function textPaintBounds(node: TextNode) {
    const { lines, leading, baseline, offset, w, h } = measureTextNode(node);
    const c = getMeter();
    c.font = font(node);
    c.textAlign = node.textAlign;
    let x = 0, y = 0, right = w, bottom = h;
    lines.forEach((line, i) => {
        const metrics = c.measureText(line), lineY = baseline + i * leading;
        const advanceLeft = node.textAlign === 'right' ? metrics.width : node.textAlign === 'center' ? metrics.width / 2 : 0;
        x = Math.min(x, offset - (metrics.actualBoundingBoxLeft ?? advanceLeft));
        right = Math.max(right, offset + (metrics.actualBoundingBoxRight ?? metrics.width - advanceLeft));
        y = Math.min(y, lineY - (metrics.actualBoundingBoxAscent ?? 0));
        bottom = Math.max(bottom, lineY + (metrics.actualBoundingBoxDescent ?? 0));
    });
    return { x, y, w: right - x, h: bottom - y };
}
