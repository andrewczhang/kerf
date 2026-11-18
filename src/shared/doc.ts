import { corner, validPoints, type PathPoint } from './path';
export const textFonts = ['sans', 'serif', 'mono'] as const;
export const textWeights = [400, 700] as const;
export const textAlignments = ['left', 'center', 'right'] as const;
export const textWidths = ['auto', 'fixed'] as const;
export const maxTextLength = 4000;
export const maxFontSize = 512;

interface TextProperties {
    text: string;
    fontFamily: typeof textFonts[number];
    fontSize: number;
    fontWeight: typeof textWeights[number];
    textAlign: typeof textAlignments[number];
    textWidth: typeof textWidths[number];
}

export interface Node extends Partial<TextProperties> {
    id: string;
    type: 'frame' | 'rect' | 'ellipse' | 'text' | 'path';
    parent: string | null;
    index: string;
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    fill: string;
    stroke: string | null;
    strokeWidth: number;
    radius: number;
    opacity: number;
    component?: boolean;
    instanceOf?: string;
    overrides?: Record<string, Partial<Record<Key, unknown>>>;
    /** path only: anchors normalized to the node box */
    points?: PathPoint[];
    /** path only */
    closed?: boolean;
}
export type TextNode = Node & TextProperties & { type: 'text' };
export const isTextNode = (node: Node | undefined): node is TextNode => node?.type === 'text';
const textKeys: (keyof TextProperties)[] = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'textWidth'];
export type Doc = Map<string, Node>;
export type Key = Exclude<keyof Node, 'id'>;
export type Op = {
    t: 'create';
    node: Node;
} | {
    t: 'set';
    id: string;
    key: Key;
    value: Node[Key];
} | {
    t: 'override';
    id: string;
    target: string;
    key: Key;
    value: unknown;
    clear?: true;
} | {
    t: 'delete';
    id: string;
};
const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function between(a: string | null = null, b: string | null = null): string {
    if (a !== null && b !== null && a >= b)
        throw Error('Invalid index bounds');
    let out = '', i = 0;
    for (;; i++) {
        const lo = a && i < a.length ? digits.indexOf(a[i]) : 0;
        const hi = b && i < b.length ? digits.indexOf(b[i]) : 61;
        if (hi - lo > 1)
            return out + digits[Math.floor((lo + hi) / 2)];
        out += digits[lo];
        if (lo < hi) {
            a = a?.slice(i + 1) || null;
            b = null;
            i = -1;
        }
    }
}
export function children(doc: Doc, parent: string | null) { return [...doc.values()].filter(n => n.parent === parent).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id)); }
export function childIndex(doc: Doc): Map<string | null, Node[]> {
    const index = new Map<string | null, Node[]>();
    for (const n of doc.values()) {
        const siblings = index.get(n.parent) ?? [];
        siblings.push(n); index.set(n.parent, siblings);
    }
    for (const siblings of index.values()) siblings.sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id));
    return index;
}
export function descendants(doc: Doc, id: string): Node[] { return children(doc, id).flatMap(n => [n, ...descendants(doc, n.id)]); }
export function applyOp(doc: Doc, op: Op): void {
    if (!op || !['create', 'set', 'delete', 'override'].includes(op.t))
        return;
    if (op.t === 'create') {
        if (validNode(op.node) && !doc.has(op.node.id) && validParent(doc, op.node) && (!op.node.instanceOf || !componentCycle(doc, op.node)))
            doc.set(op.node.id, { ...op.node });
        return;
    }
    const n = doc.get(op.id);
    if (!n)
        return;
    if (op.t === 'override') {
        if (!n.instanceOf || typeof op.target !== 'string' || !overridable(op.key))
            return;
        const overrides = { ...n.overrides }, values = { ...overrides[op.target] };
        if (op.clear)
            delete values[op.key];
        else {
            if (!validProperty(op.key, op.value))
                return;
            values[op.key] = op.value;
        }
        if (Object.keys(values).length)
            Object.defineProperty(overrides, op.target, { value: values, enumerable: true, configurable: true, writable: true });
        else
            delete overrides[op.target];
        doc.set(n.id, { ...n, overrides });
        return;
    }
    if (op.t === 'delete') {
        for (const c of descendants(doc, n.id))
            doc.delete(c.id);
        doc.delete(n.id);
        return;
    }
    if (!['type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'stroke', 'strokeWidth', 'radius', 'opacity', 'component', 'overrides', 'points', 'closed', ...textKeys].includes(op.key))
        return;
    if (textKeys.some(key => key === op.key) && n.type !== 'text')
        return;
    if (op.key === 'type' && (n.type === 'text' || op.value === 'text'))
        return;
    if (op.key === 'parent') {
        let p = op.value as string | null;
        const seen = new Set([n.id]);
        while (p) {
            if (seen.has(p))
                return;
            seen.add(p);
            p = doc.get(p)?.parent ?? null;
        }
        if (!validParent(doc, { ...n, parent: op.value as string | null }))
            return;
    }
    const next = { ...n, [op.key]: op.value };
    if (validNode(next) && (op.key !== 'parent' || !componentCycle(doc, next)))
        doc.set(n.id, next);
}
export function overridable(key: string): key is Key { return !['id', 'type', 'parent', 'index', 'x', 'y', 'w', 'h', 'component', 'instanceOf', 'overrides'].includes(key); }
function validParent(doc: Doc, n: Node): boolean { const p = n.parent === null ? undefined : doc.get(n.parent); return n.parent === null || (!!p && p.type === 'frame' && !p.instanceOf); }
function componentCycle(doc: Doc, next: Node): boolean {
    const byParent = new Map<string, Node[]>();
    for (const n of doc.values()) {
        if (n.id === next.id || n.parent === null)
            continue;
        const siblings = byParent.get(n.parent) ?? [];
        siblings.push(n);
        byParent.set(n.parent, siblings);
    }
    const instances: Node[] = [], visited = new Set<string>();
    const collect = (n: Node) => {
        if (visited.has(n.id)) return;
        visited.add(n.id);
        if (n.instanceOf) instances.push(n);
        for (const c of byParent.get(n.id) ?? []) collect(c);
    };
    collect(next);
    if (!instances.length) return false;
    const ancestors = new Set([next.id]);
    let p = next.parent;
    while (p && !ancestors.has(p)) { ancestors.add(p); p = doc.get(p)?.parent ?? null; }
    const seen = new Set<string>();
    const reaches = (id: string): boolean => {
        if (ancestors.has(id)) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        const n = doc.get(id);
        return !!(n?.instanceOf && reaches(n.instanceOf)) || (byParent.get(id) ?? []).some(c => reaches(c.id));
    };
    return instances.some(n => reaches(n.instanceOf!));
}
function plain(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype; }
function validOverrides(value: unknown): boolean {
    return plain(value) && Object.values(value).every(values => plain(values) && Object.entries(values).every(([key, v]) => overridable(key) && validProperty(key, v)));
}
function validProperty(key: string, value: unknown): boolean {
    if (['id', 'index', 'name'].includes(key)) return typeof value === 'string';
    if (key === 'type') return ['frame', 'rect', 'ellipse', 'text', 'path'].includes(value as string);
    if (key === 'points') return validPoints(value);
    if (key === 'closed') return typeof value === 'boolean';
    if (key === 'text') return typeof value === 'string' && value.length <= maxTextLength;
    if (key === 'fontFamily') return textFonts.includes(value as typeof textFonts[number]);
    if (key === 'fontWeight') return textWeights.includes(value as typeof textWeights[number]);
    if (key === 'textAlign') return textAlignments.includes(value as typeof textAlignments[number]);
    if (key === 'textWidth') return textWidths.includes(value as typeof textWidths[number]);
    if (key === 'fontSize') return typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= maxFontSize;
    if (key === 'parent') return value === null || typeof value === 'string';
    if (key === 'component') return value === undefined || typeof value === 'boolean';
    if (key === 'instanceOf') return value === undefined || typeof value === 'string';
    if (key === 'overrides') return value === undefined || validOverrides(value);
    if (key === 'stroke' && value === null) return true;
    if (key === 'fill' || key === 'stroke') return typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
    if (!['x', 'y', 'w', 'h', 'strokeWidth', 'radius', 'opacity'].includes(key) || typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (key === 'w' || key === 'h') return value >= 1;
    if (key === 'opacity') return value >= 0 && value <= 1;
    return key === 'x' || key === 'y' || value >= 0;
}
export function validNode(n: Node): boolean { return !!n && ['id', 'type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'stroke', 'strokeWidth', 'radius', 'opacity', 'component', 'instanceOf', 'overrides', ...(n.type === 'text' ? textKeys : []), ...(n.type === 'path' ? ['points', 'closed'] : [])].every(key => validProperty(key, n[key as keyof Node])); }
export function makeNode(type: 'text', x: number, y: number, index?: string): TextNode;
export function makeNode(type: Node['type'], x: number, y: number, index?: string): Node;
export function makeNode(type: Node['type'], x: number, y: number, index = between()): Node {
    const node = { id: crypto.randomUUID(), type, parent: null, index, name: { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', path: 'Path' }[type], x, y, w: 100, h: 100, fill: type === 'frame' ? '#ffffff' : '#ff4f00', stroke: null, strokeWidth: 1, radius: 0, opacity: 1 };
    if (type === 'text')
        return { ...node, w: 240, h: 29, fill: '#272822', text: 'Text', fontFamily: 'sans', fontSize: 24, fontWeight: 400, textAlign: 'left', textWidth: 'auto' };
    if (type === 'path')
        return { ...node, stroke: '#272822', strokeWidth: 2, points: [corner(0, 0)], closed: false };
    return node;
}
