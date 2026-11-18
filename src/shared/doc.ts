import { mergeText } from './text-edit';
import { corner, validPoints, type PathPoint } from './path';
import { docIndex } from './doc-index';
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
export const strokeAlignments = ['inside', 'center', 'outside'] as const;
export const strokeCaps = ['butt', 'round', 'square'] as const;
export const strokeJoins = ['miter', 'round', 'bevel'] as const;
export const arrowheads = ['none', 'line', 'triangle', 'circle', 'bar'] as const;
export const horizontalConstraints = ['left', 'right', 'both', 'center', 'scale'] as const;
export const verticalConstraints = ['top', 'bottom', 'both', 'center', 'scale'] as const;

interface TextProperties {
    text: string;
    fontFamily: typeof textFonts[number];
    fontSize: number;
    fontWeight: typeof textWeights[number];
    textAlign: typeof textAlignments[number];
    textWidth: typeof textWidths[number];
}

interface StrokeProperties {
    strokeAlign: typeof strokeAlignments[number];
    strokeDash: number;
    strokeGap: number;
    strokeCap: typeof strokeCaps[number];
    strokeJoin: typeof strokeJoins[number];
    strokeMiterLimit: number;
    strokeStart: typeof arrowheads[number];
    strokeEnd: typeof arrowheads[number];
}

export interface Node extends Partial<TextProperties & StrokeProperties> {
    grids?: LayoutGrid[];
    fillStyle?: string | null;
    strokeStyle?: string | null;
    textStyle?: string | null;
    link?: string | null;
    id: string;
    type: 'frame' | 'rect' | 'ellipse' | 'text' | 'path' | 'group' | 'page';
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
    /** path only: extra closed contours of a compound path (boolean results), normalized like points, filled even-odd */
    contours?: PathPoint[][];
    /** how the node follows its parent frame's width; default left */
    constraintH?: typeof horizontalConstraints[number];
    /** how the node follows its parent frame's height; default top */
    constraintV?: typeof verticalConstraints[number];
    mask?: boolean;
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
const strokeKeys: (keyof StrokeProperties)[] = ['strokeAlign', 'strokeDash', 'strokeGap', 'strokeCap', 'strokeJoin', 'strokeMiterLimit', 'strokeStart', 'strokeEnd'];
export const isOpenPath = (node: Node) => node.type === 'path' && !node.closed;
export function strokeOptions(node: Node): StrokeProperties {
    return {
        strokeAlign: isOpenPath(node) ? 'center' : node.strokeAlign ?? 'center',
        strokeDash: node.strokeDash ?? 0,
        strokeGap: node.strokeGap ?? 0,
        strokeCap: node.strokeCap ?? (node.type === 'path' ? 'round' : 'butt'),
        strokeJoin: node.strokeJoin ?? (node.type === 'path' ? 'round' : 'miter'),
        strokeMiterLimit: node.strokeMiterLimit ?? 10,
        strokeStart: node.strokeStart ?? 'none',
        strokeEnd: node.strokeEnd ?? 'none',
    };
}
export type Doc = Map<string, Node>;
export interface LayoutGrid { id?: string; type: 'columns' | 'rows' | 'grid'; count: number; size: number; gutter: number; margin: number; color: string; opacity: number; visible: boolean }
function validGrid(g: LayoutGrid): boolean {
    if (g?.id !== undefined && (typeof g.id !== 'string' || g.id.length < 1 || g.id.length > 64)) return false;
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
    baseText?: string;
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
export function children(doc: Doc, parent: string | null) { return docIndex(doc)?.children(parent) ?? [...doc.values()].filter(n => n.parent === parent).sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id)); }
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
        if (n.type === 'page' && [...doc.values()].filter(n => n.type === 'page').length <= 1) return;
        for (const c of descendants(doc, n.id))
            doc.delete(c.id);
        doc.delete(n.id);
        return;
    }
    if (!['mask', 'rotation', 'grids', 'fillStyle', 'strokeStyle', 'textStyle', 'hidden', 'locked', 'link', 'type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'fills', 'effects', 'stroke', 'strokeWidth', 'radius', 'opacity', 'points', 'closed', 'contours', 'constraintH', 'constraintV', ...textKeys, ...strokeKeys, ...Object.keys(layoutDefaults)].includes(op.key))
        return;
    if ((textKeys.some(key => key === op.key) || op.key === 'textStyle') && n.type !== 'text')
        return;
    if (n.type === 'page' && !['name', 'index'].includes(op.key)) return;
    if (op.key === 'type' && (n.type === 'text' || op.value === 'text' || op.value === 'page'))
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
        if (op.value !== null && !['frame', 'group', 'page'].includes(doc.get(op.value as string)?.type ?? ''))
            return;
    }
    const value = op.key === 'text' && isTextNode(n) && typeof op.baseText === 'string'
        && typeof op.value === 'string' && op.baseText.length <= maxTextLength && op.value.length <= maxTextLength
        ? mergeText(op.baseText, op.value, n.text) : op.value;
    const next = { ...n, [op.key]: value };
    if (validLink(next.link) && validNode(next))
        doc.set(n.id, normalizeNode(next));
}
export function normalizeRotation(angle: number): number { return ((angle + 180) % 360 + 360) % 360 - 180; }
export function normalizeNode(n: Node): Node { return n.type === 'page' ? { ...n, parent: null, x: 0, y: 0, w: 1, h: 1, rotation: 0, hidden: false, locked: false, fill: '#000000', stroke: null, strokeWidth: 0, radius: 0, opacity: 1 } : { ...n, hidden: n.hidden ?? false, locked: n.locked ?? false, rotation: n.type === 'group' ? 0 : normalizeRotation(n.rotation ?? 0) }; }
export function validLink(link: unknown): boolean { return link == null || typeof link === 'string'; }
export function maskEligible(n: Node): boolean { return n.type === 'rect' || n.type === 'ellipse' || n.type === 'path' && !!n.closed; }
export function validNode(n: Node): boolean {
    if (n && (n.mask !== undefined && typeof n.mask !== 'boolean' || n.mask === true && !maskEligible(n))) return false;
    if (n?.type === 'page') return n.parent === null && typeof n.id === 'string' && typeof n.name === 'string' && typeof n.index === 'string';
    if (!n || !validLink(n.link) || !validStroke(n) || n.rotation !== undefined && !Number.isFinite(n.rotation) || !validLink(n.fillStyle) || !validLink(n.strokeStyle) || !validLink(n.textStyle) || n.type !== 'text' && n.textStyle != null) return false;
    if (n.grids !== undefined && (n.type !== 'frame' || !Array.isArray(n.grids) || n.grids.length > 8 || !n.grids.every(validGrid))) return false;
    return !!n && validLayout(n) && typeof n.id === 'string' && ['frame', 'rect', 'ellipse', 'text', 'path', 'group'].includes(n.type) && ['hidden', 'locked'].every(k => n[k as keyof Node] === undefined || typeof n[k as keyof Node] === 'boolean') && (n.type !== 'path' || validPoints(n.points) && typeof n.closed === 'boolean' && (n.contours === undefined || Array.isArray(n.contours) && n.contours.length <= 200 && n.contours.every(validPoints))) && typeof n.index === 'string' && typeof n.name === 'string' && (n.parent === null || typeof n.parent === 'string') && ['x', 'y', 'w', 'h', 'strokeWidth', 'radius', 'opacity'].every(k => Number.isFinite(n[k as keyof Node])) && n.w >= 1 && n.h >= 1 && n.opacity >= 0 && n.opacity <= 1 && n.radius >= 0 && n.strokeWidth >= 0 && /^#[\da-f]{6}$/i.test(n.fill) && (n.stroke === null || /^#[\da-f]{6}$/i.test(n.stroke)) && (n.constraintH === undefined || horizontalConstraints.includes(n.constraintH)) && (n.constraintV === undefined || verticalConstraints.includes(n.constraintV)) && (n.type !== 'text' || validText(n)) && (n.fills === undefined || Array.isArray(n.fills) && n.fills.length <= 12 && n.fills.every(validPaint)) && (n.effects === undefined || Array.isArray(n.effects) && n.effects.length <= 8 && n.effects.every(validEffect));
}
function validStroke(n: Node): boolean {
    const length = (v: number | undefined, min: number) => v === undefined || Number.isFinite(v) && v >= min;
    return (n.strokeAlign === undefined || strokeAlignments.includes(n.strokeAlign))
        && (n.strokeCap === undefined || strokeCaps.includes(n.strokeCap))
        && (n.strokeJoin === undefined || strokeJoins.includes(n.strokeJoin))
        && (n.strokeStart === undefined || arrowheads.includes(n.strokeStart))
        && (n.strokeEnd === undefined || arrowheads.includes(n.strokeEnd))
        && length(n.strokeDash, 0) && length(n.strokeGap, 0) && length(n.strokeMiterLimit, 1);
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
    const node = { id: crypto.randomUUID(), type, hidden: false, locked: false, parent: null, index, name: { page: 'Page', group: 'Group', frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', path: 'Path' }[type], x, y, w: 100, h: 100, fill: type === 'frame' ? '#ffffff' : '#ff4f00', stroke: null, strokeWidth: 1, radius: 0, opacity: 1 };
    if (type === 'text')
        return { ...node, rotation: 0, w: 240, h: 29, fill: '#272822', text: 'Text', fontFamily: 'sans', fontSize: 24, fontWeight: 400, textAlign: 'left', textWidth: 'auto' };
    if (type === 'path')
        return { ...node, rotation: 0, stroke: '#272822', strokeWidth: 2, points: [corner(0, 0)], closed: false };
    return { ...node, rotation: 0 };
}
