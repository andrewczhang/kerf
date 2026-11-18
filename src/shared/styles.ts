import { maxFontSize, textFonts, textWeights, type Doc, type Key, type Op, type Node } from './doc';
import { expand } from './components';
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
    const ops: Op[] = []; let resolved: Doc | undefined;
    for (const { node: n, path, values } of styleTargets(doc)) for (const target of ['fill', 'stroke', 'text'] as const) {
        const link = target === 'text' ? 'textStyle' : target === 'fill' ? 'fillStyle' : 'strokeStyle';
        if (values[link] !== style.id || (target === 'text' ? style.kind !== 'text' : style.kind !== 'color')) continue;
        if (target === 'text' && (path === undefined ? n : (resolved ??= expand(doc)).get(n.id + (path ? '/' + path : '')))?.type !== 'text') continue;
        for (const [key, value] of Object.entries(styleValues(style, target)))
            if (JSON.stringify(values[key as Key]) !== JSON.stringify(value)) ops.push(path === undefined ? { t: 'set', id: n.id, key: key as Key, value } : { t: 'override', id: n.id, target: path, key: key as Key, value });
    }
    return ops;
}
export function detachOps(doc: Doc, styleId: string): Op[] {
    const ops: Op[] = [];
    for (const { node: n, path, values } of styleTargets(doc)) for (const key of ['fillStyle', 'strokeStyle', 'textStyle'] as const)
        if (values[key] === styleId) ops.push(path === undefined ? { t: 'set', id: n.id, key, value: null } : { t: 'override', id: n.id, target: path, key, value: null });
    return ops;
}
export function resolveStyleOps(doc: Doc, styles: Style[], ops: Op[]): Op[] {
    const linked = new Set<string>(), address = (id: string, path: string | undefined, key: string) => JSON.stringify([id, path, key]);
    for (const op of ops) {
        if (op.t !== 'set' && op.t !== 'override') continue;
        const node = doc.get(op.id);
        if (!node) continue;
        if (op.t === 'set' && op.key === 'overrides') {
            for (const [path, values] of Object.entries(node.overrides ?? {}))
                for (const key of ['fillStyle', 'strokeStyle', 'textStyle']) if (typeof values[key as Key] === 'string') linked.add(address(node.id, path, key));
        } else if (['fillStyle', 'strokeStyle', 'textStyle'].includes(op.key) && typeof op.value === 'string' && !(op.t === 'override' && op.clear)) {
            const path = op.t === 'override' ? op.target : undefined, values = path === undefined ? node : node.overrides?.[path];
            if (values?.[op.key] === op.value) linked.add(address(node.id, path, op.key));
        }
    }
    if (!linked.size) return [];
    return styles.flatMap(style => styleOps(doc, style).filter(op => {
        if (op.t !== 'set' && op.t !== 'override') return false;
        const key = ['fill', 'fills', 'fillStyle'].includes(op.key) ? 'fillStyle' : ['stroke', 'strokeStyle'].includes(op.key) ? 'strokeStyle' : 'textStyle';
        return linked.has(address(op.id, op.t === 'override' ? op.target : undefined, key));
    }));
}
function* styleTargets(doc: Doc) {
    for (const node of doc.values()) {
        yield { node, path: undefined as string | undefined, values: node as Partial<Record<Key, unknown>> };
        if (node.instanceOf) for (const [path, values] of Object.entries(node.overrides ?? {})) yield { node, path, values };
    }
}
