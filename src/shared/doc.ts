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
    link?: string | null;
    id: string;
    type: 'frame' | 'rect' | 'ellipse' | 'text' | 'path' | 'group';
    hidden: boolean;
    locked: boolean;
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
    /** path only: anchors normalized to the node box */
    points?: PathPoint[];
    /** path only */
    closed?: boolean;
    /** path only: extra closed contours of a compound path (boolean results), normalized like points, filled even-odd */
    contours?: PathPoint[][];
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
export function descendants(doc: Doc, id: string): Node[] { return children(doc, id).flatMap(n => [n, ...descendants(doc, n.id)]); }
export function applyOp(doc: Doc, op: Op): void {
    if (!op || !['create', 'set', 'delete'].includes(op.t))
        return;
    if (op.t === 'create') {
        if (validNode(op.node) && !doc.has(op.node.id))
            doc.set(op.node.id, normalizeNode(op.node));
        return;
    }
    const n = doc.get(op.id);
    if (!n)
        return;
    if (op.t === 'delete') {
        for (const c of descendants(doc, n.id))
            doc.delete(c.id);
        doc.delete(n.id);
        return;
    }
    if (!['hidden', 'locked', 'link', 'type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'stroke', 'strokeWidth', 'radius', 'opacity', 'points', 'closed', 'contours', ...textKeys].includes(op.key))
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
        if (op.value !== null && !['frame', 'group'].includes(doc.get(op.value as string)?.type ?? ''))
            return;
    }
    const next = { ...n, [op.key]: op.value };
    if (validLink(next.link) && validNode(next))
        doc.set(n.id, next);
}
export function normalizeNode(n: Node): Node { return { ...n, hidden: n.hidden ?? false, locked: n.locked ?? false }; }
export function validLink(link: unknown): boolean { return link == null || typeof link === 'string'; }
export function validNode(n: Node): boolean {
    if (!n || !validLink(n.link)) return false;
    return !!n && typeof n.id === 'string' && ['frame', 'rect', 'ellipse', 'text', 'path', 'group'].includes(n.type) && ['hidden', 'locked'].every(k => n[k as keyof Node] === undefined || typeof n[k as keyof Node] === 'boolean') && (n.type !== 'path' || validPoints(n.points) && typeof n.closed === 'boolean' && (n.contours === undefined || Array.isArray(n.contours) && n.contours.length <= 200 && n.contours.every(validPoints))) && typeof n.index === 'string' && typeof n.name === 'string' && (n.parent === null || typeof n.parent === 'string') && ['x', 'y', 'w', 'h', 'strokeWidth', 'radius', 'opacity'].every(k => Number.isFinite(n[k as keyof Node])) && n.w >= 1 && n.h >= 1 && n.opacity >= 0 && n.opacity <= 1 && n.radius >= 0 && n.strokeWidth >= 0 && /^#[\da-f]{6}$/i.test(n.fill) && (n.stroke === null || /^#[\da-f]{6}$/i.test(n.stroke)) && (n.type !== 'text' || validText(n));
}
function validText(n: Node): boolean {
    return typeof n.text === 'string' && n.text.length <= maxTextLength
        && n.fontFamily !== undefined && textFonts.includes(n.fontFamily)
        && typeof n.fontSize === 'number' && Number.isFinite(n.fontSize) && n.fontSize >= 1 && n.fontSize <= maxFontSize
        && n.fontWeight !== undefined && textWeights.includes(n.fontWeight)
        && n.textAlign !== undefined && textAlignments.includes(n.textAlign)
        && n.textWidth !== undefined && textWidths.includes(n.textWidth);
}
export function makeNode(type: 'text', x: number, y: number, index?: string): TextNode;
export function makeNode(type: Node['type'], x: number, y: number, index?: string): Node;
export function makeNode(type: Node['type'], x: number, y: number, index = between()): Node {
    const node = { id: crypto.randomUUID(), type, hidden: false, locked: false, parent: null, index, name: { group: 'Group', frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', path: 'Path' }[type], x, y, w: 100, h: 100, fill: type === 'frame' ? '#ffffff' : '#ff4f00', stroke: null, strokeWidth: 1, radius: 0, opacity: 1 };
    if (type === 'text')
        return { ...node, w: 240, h: 29, fill: '#272822', text: 'Text', fontFamily: 'sans', fontSize: 24, fontWeight: 400, textAlign: 'left', textWidth: 'auto' };
    if (type === 'path')
        return { ...node, stroke: '#272822', strokeWidth: 2, points: [corner(0, 0)], closed: false };
    return node;
}
