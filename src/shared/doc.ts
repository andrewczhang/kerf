import { corner, validPoints, type PathPoint } from './path';
export type Paint = { type: 'solid'; color: string; opacity: number; visible: boolean } | { type: 'linear' | 'radial'; stops: { pos: number; color: string; opacity: number }[]; from: { x: number; y: number }; to: { x: number; y: number }; opacity: number; visible: boolean } | { type: 'image'; asset: string; fit: 'fill' | 'fit' | 'tile'; w: number; h: number; opacity: number; visible: boolean };
export type Effect = { type: 'drop-shadow' | 'inner-shadow'; x: number; y: number; blur: number; spread: number; color: string; opacity: number; visible: boolean } | { type: 'layer-blur' | 'background-blur'; radius: number; visible: boolean };
export function nodeFills(n: Node): Paint[] { return n.fills ?? [{ type: 'solid', color: n.fill, opacity: 1, visible: true }]; }
const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const color = (v: unknown) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (v: any) => !!v && finite(v.x) && finite(v.y) && v.x >= -2 && v.x <= 3 && v.y >= -2 && v.y <= 3;
function validPaint(p: any): boolean { return !!p && typeof p.visible === 'boolean' && unit(p.opacity) && (p.type === 'solid' ? color(p.color) : p.type === 'image' ? typeof p.asset === 'string' && /^[\da-f]{64}$/i.test(p.asset) && ['fill', 'fit', 'tile'].includes(p.fit) && finite(p.w) && p.w > 0 && finite(p.h) && p.h > 0 : ['linear', 'radial'].includes(p.type) && point(p.from) && point(p.to) && Array.isArray(p.stops) && p.stops.length >= 2 && p.stops.length <= 16 && p.stops.every((s: any) => !!s && unit(s.pos) && color(s.color) && unit(s.opacity))); }
function validEffect(e: any): boolean { return !!e && typeof e.visible === 'boolean' && (['layer-blur', 'background-blur'].includes(e.type) ? finite(e.radius) && e.radius >= 0 : ['drop-shadow', 'inner-shadow'].includes(e.type) && [e.x, e.y, e.blur, e.spread].every(finite) && e.blur >= 0 && color(e.color) && unit(e.opacity)); }
export const textFonts = ['sans', 'serif', 'mono'] as const;
export const textWeights = [400, 700] as const;
export const textAlignments = ['left', 'center', 'right'] as const;
export const textWidths = ['auto', 'fixed'] as const;
export const maxTextLength = 100000;
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
    grids?: LayoutGrid[];
    link?: string | null;
    id: string;
    type: 'frame' | 'rect' | 'ellipse' | 'text' | 'path' | 'group';
    hidden: boolean;
    locked: boolean;
    rotation?: number;
    parent: string | null;
    index: string;
    name: string;
    x: number;
    y: number;
    w: number;
    h: number;
    fill: string;
    fills?: Paint[];
    effects?: Effect[];
    stroke: string | null;
    strokeWidth: number;
    radius: number;
    opacity: number;
    layout?: 'none' | 'horizontal' | 'vertical';
    gap?: number;
    padTop?: number;
    padRight?: number;
    padBottom?: number;
    padLeft?: number;
    justify?: 'start' | 'center' | 'end' | 'between';
    align?: 'start' | 'center' | 'end';
    sizeW?: 'fixed' | 'hug' | 'fill';
    sizeH?: 'fixed' | 'hug' | 'fill';
    /** path only: anchors normalized to the node box */
    points?: PathPoint[];
    /** path only */
    closed?: boolean;
}
export const layoutDefaults = { layout: 'none', gap: 0, padTop: 0, padRight: 0, padBottom: 0, padLeft: 0, justify: 'start', align: 'start', sizeW: 'fixed', sizeH: 'fixed' } as const;
function validLayout(n: Node): boolean {
    return (['gap', 'padTop', 'padRight', 'padBottom', 'padLeft'] as const).every(k => n[k] === undefined || (Number.isFinite(n[k]) && n[k]! >= 0))
        && (Object.keys(layoutEnums) as (keyof typeof layoutEnums)[]).every(k => n[k] === undefined || layoutEnums[k].includes(n[k]!));
}
const layoutEnums: Record<'layout' | 'justify' | 'align' | 'sizeW' | 'sizeH', readonly string[]> = {
    layout: ['none', 'horizontal', 'vertical'], justify: ['start', 'center', 'end', 'between'], align: ['start', 'center', 'end'], sizeW: ['fixed', 'hug', 'fill'], sizeH: ['fixed', 'hug', 'fill']
};
export type TextNode = Node & TextProperties & { type: 'text' };
export const isTextNode = (node: Node | undefined): node is TextNode => node?.type === 'text';
const textKeys: (keyof TextProperties)[] = ['text', 'fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'textWidth'];
export type Doc = Map<string, Node>;
export interface LayoutGrid { type: 'columns' | 'rows' | 'grid'; count: number; size: number; gutter: number; margin: number; color: string; opacity: number; visible: boolean }
function validGrid(g: LayoutGrid): boolean {
    return !!g && ['columns', 'rows', 'grid'].includes(g.type) && Number.isInteger(g.count) && g.count >= 1 && g.count <= 100 && finite(g.size) && g.size >= 2 && g.size <= 10000 && finite(g.gutter) && g.gutter >= 0 && finite(g.margin) && g.margin >= 0 && color(g.color) && unit(g.opacity) && typeof g.visible === 'boolean';
}
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
    if (!['rotation', 'grids', 'hidden', 'locked', 'link', 'type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'fills', 'effects', 'stroke', 'strokeWidth', 'radius', 'opacity', 'points', 'closed', ...textKeys, ...Object.keys(layoutDefaults)].includes(op.key))
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
        doc.set(n.id, normalizeNode(next));
}
export function normalizeRotation(angle: number): number { return ((angle + 180) % 360 + 360) % 360 - 180; }
export function normalizeNode(n: Node): Node { return { ...n, hidden: n.hidden ?? false, locked: n.locked ?? false, rotation: n.type === 'group' ? 0 : normalizeRotation(n.rotation ?? 0) }; }
export function validLink(link: unknown): boolean { return link == null || typeof link === 'string'; }
export function validNode(n: Node): boolean {
    if (!n || !validLink(n.link) || n.rotation !== undefined && !Number.isFinite(n.rotation)) return false;
    if (n.grids !== undefined && (n.type !== 'frame' || !Array.isArray(n.grids) || n.grids.length > 8 || !n.grids.every(validGrid))) return false;
    return !!n && validLayout(n) && typeof n.id === 'string' && ['frame', 'rect', 'ellipse', 'text', 'path', 'group'].includes(n.type) && ['hidden', 'locked'].every(k => n[k as keyof Node] === undefined || typeof n[k as keyof Node] === 'boolean') && (n.type !== 'path' || validPoints(n.points) && typeof n.closed === 'boolean') && typeof n.index === 'string' && typeof n.name === 'string' && (n.parent === null || typeof n.parent === 'string') && ['x', 'y', 'w', 'h', 'strokeWidth', 'radius', 'opacity'].every(k => Number.isFinite(n[k as keyof Node])) && n.w >= 1 && n.h >= 1 && n.opacity >= 0 && n.opacity <= 1 && n.radius >= 0 && n.strokeWidth >= 0 && /^#[\da-f]{6}$/i.test(n.fill) && (n.stroke === null || /^#[\da-f]{6}$/i.test(n.stroke)) && (n.type !== 'text' || validText(n)) && (n.fills === undefined || Array.isArray(n.fills) && n.fills.length <= 12 && n.fills.every(validPaint)) && (n.effects === undefined || Array.isArray(n.effects) && n.effects.length <= 8 && n.effects.every(validEffect));
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
        return { ...node, rotation: 0, w: 240, h: 29, fill: '#272822', text: 'Text', fontFamily: 'sans', fontSize: 24, fontWeight: 400, textAlign: 'left', textWidth: 'auto' };
    if (type === 'path')
        return { ...node, rotation: 0, stroke: '#272822', strokeWidth: 2, points: [corner(0, 0)], closed: false };
    return { ...node, rotation: 0 };
}
