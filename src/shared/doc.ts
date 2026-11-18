export type Paint = { type: 'solid'; color: string; opacity: number; visible: boolean } | { type: 'linear' | 'radial'; stops: { pos: number; color: string; opacity: number }[]; from: { x: number; y: number }; to: { x: number; y: number }; opacity: number; visible: boolean } | { type: 'image'; asset: string; fit: 'fill' | 'fit' | 'tile'; w: number; h: number; opacity: number; visible: boolean };
export type Effect = { type: 'drop-shadow' | 'inner-shadow'; x: number; y: number; blur: number; spread: number; color: string; opacity: number; visible: boolean } | { type: 'layer-blur' | 'background-blur'; radius: number; visible: boolean };
export function nodeFills(n: Node): Paint[] { return n.fills ?? [{ type: 'solid', color: n.fill, opacity: 1, visible: true }]; }
const unit = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const color = (v: unknown) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const point = (v: any) => !!v && finite(v.x) && finite(v.y) && v.x >= -2 && v.x <= 3 && v.y >= -2 && v.y <= 3;
function validPaint(p: any): boolean { return !!p && typeof p.visible === 'boolean' && unit(p.opacity) && (p.type === 'solid' ? color(p.color) : p.type === 'image' ? typeof p.asset === 'string' && /^[\da-f]{64}$/i.test(p.asset) && ['fill', 'fit', 'tile'].includes(p.fit) && finite(p.w) && p.w > 0 && finite(p.h) && p.h > 0 : ['linear', 'radial'].includes(p.type) && point(p.from) && point(p.to) && Array.isArray(p.stops) && p.stops.length >= 2 && p.stops.length <= 16 && p.stops.every((s: any) => !!s && unit(s.pos) && color(s.color) && unit(s.opacity))); }
function validEffect(e: any): boolean { return !!e && typeof e.visible === 'boolean' && (['layer-blur', 'background-blur'].includes(e.type) ? finite(e.radius) && e.radius >= 0 : ['drop-shadow', 'inner-shadow'].includes(e.type) && [e.x, e.y, e.blur, e.spread].every(finite) && e.blur >= 0 && color(e.color) && unit(e.opacity)); }
export interface Node {
    id: string;
    type: 'frame' | 'rect' | 'ellipse';
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
}
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
        if (!doc.has(op.node.id) && validNode(op.node))
            doc.set(op.node.id, { ...op.node });
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
    if (!['type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'fills', 'effects', 'stroke', 'strokeWidth', 'radius', 'opacity'].includes(op.key))
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
        if (op.value !== null && doc.get(op.value as string)?.type !== 'frame')
            return;
    }
    const next = { ...n, [op.key]: op.value };
    if (validNode(next))
        doc.set(n.id, next);
}
export function validNode(n: Node): boolean { return !!n && typeof n.id === 'string' && ['frame', 'rect', 'ellipse'].includes(n.type) && typeof n.index === 'string' && typeof n.name === 'string' && (n.parent === null || typeof n.parent === 'string') && ['x', 'y', 'w', 'h', 'strokeWidth', 'radius', 'opacity'].every(k => Number.isFinite(n[k as keyof Node])) && n.w >= 1 && n.h >= 1 && n.opacity >= 0 && n.opacity <= 1 && n.radius >= 0 && n.strokeWidth >= 0 && /^#[\da-f]{6}$/i.test(n.fill) && (n.stroke === null || /^#[\da-f]{6}$/i.test(n.stroke)) && (n.fills === undefined || Array.isArray(n.fills) && n.fills.length <= 12 && n.fills.every(validPaint)) && (n.effects === undefined || Array.isArray(n.effects) && n.effects.length <= 8 && n.effects.every(validEffect)); }
export function makeNode(type: Node['type'], x: number, y: number, index = between()): Node { return { id: crypto.randomUUID(), type, parent: null, index, name: type === 'frame' ? 'Frame' : type === 'rect' ? 'Rectangle' : 'Ellipse', x, y, w: 100, h: 100, fill: type === 'frame' ? '#ffffff' : '#ff4f00', stroke: null, strokeWidth: 1, radius: 0, opacity: 1 }; }
