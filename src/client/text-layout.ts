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
export function measureTextNode(node: TextNode) {
    let layout = layouts.get(node);
    if (!layout) {
        const c = meter ??= document.createElement('canvas').getContext('2d')!;
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
