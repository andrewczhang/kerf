import { maxFontSize, textFonts, textWeights, type Doc, type Op, type Node } from './doc';
export interface ColorStyle { id: string; kind: 'color'; name: string; color: string }
export interface TextStyle { id: string; kind: 'text'; name: string; fontFamily: typeof textFonts[number]; fontSize: number; fontWeight: typeof textWeights[number] }
export type Style = ColorStyle | TextStyle;
export function validStyle(value: unknown): value is Style {
    if (!value || typeof value !== 'object') return false;
    const s = value as Style;
    return typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 100 && typeof s.name === 'string' && s.name.trim().length > 0 && s.name.length <= 100 && (s.kind === 'color' ? typeof s.color === 'string' && /^#[\da-f]{6}$/i.test(s.color) : s.kind === 'text' && textFonts.includes(s.fontFamily) && textWeights.includes(s.fontWeight) && Number.isFinite(s.fontSize) && s.fontSize >= 1 && s.fontSize <= maxFontSize);
}
export function styleValues(style: Style, target: 'fill' | 'stroke' | 'text'): Partial<Node> {
    if (style.kind === 'text') return { textStyle: style.id, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight };
    return target === 'fill' ? { fillStyle: style.id, fill: style.color, fills: [{ type: 'solid', color: style.color, opacity: 1, visible: true }] } : { strokeStyle: style.id, stroke: style.color };
}
export function styleOps(doc: Doc, style: Style): Op[] {
    if (!validStyle(style)) return [];
    const ops: Op[] = [];
    for (const n of doc.values()) for (const target of ['fill', 'stroke', 'text'] as const) {
        const link = target === 'text' ? 'textStyle' : target === 'fill' ? 'fillStyle' : 'strokeStyle';
        if (n[link] !== style.id || (target === 'text' ? style.kind !== 'text' || n.type !== 'text' : style.kind !== 'color')) continue;
        for (const [key, value] of Object.entries(styleValues(style, target))) if (JSON.stringify(n[key as keyof Node]) !== JSON.stringify(value)) ops.push({ t: 'set', id: n.id, key, value } as Op);
    }
    return ops;
}
export function detachOps(doc: Doc, styleId: string): Op[] {
    const ops: Op[] = [];
    for (const n of doc.values()) for (const key of ['fillStyle', 'strokeStyle', 'textStyle'] as const) if (n[key] === styleId) ops.push({ t: 'set', id: n.id, key, value: null });
    return ops;
}
export function resolveStyleOps(doc: Doc, styles: Style[], ops: Op[]): Op[] {
    const linked = new Map<string, Doc>();
    for (const op of ops) {
        if (op.t !== 'set' || !['fillStyle', 'strokeStyle', 'textStyle'].includes(op.key) || typeof op.value !== 'string') continue;
        const node = doc.get(op.id);
        if (!node || node[op.key] !== op.value) continue;
        const nodes = linked.get(op.value) ?? new Map();
        nodes.set(node.id, node); linked.set(op.value, nodes);
    }
    return styles.flatMap(style => { const nodes = linked.get(style.id); return nodes ? styleOps(nodes, style) : []; });
}
