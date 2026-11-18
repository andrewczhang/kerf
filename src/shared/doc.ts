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
    if (!['type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'stroke', 'strokeWidth', 'radius', 'opacity'].includes(op.key))
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
export function validNode(n: Node): boolean { return !!n && typeof n.id === 'string' && ['frame', 'rect', 'ellipse'].includes(n.type) && typeof n.index === 'string' && typeof n.name === 'string' && (n.parent === null || typeof n.parent === 'string') && ['x', 'y', 'w', 'h', 'strokeWidth', 'radius', 'opacity'].every(k => Number.isFinite(n[k as keyof Node])) && n.w >= 1 && n.h >= 1 && n.opacity >= 0 && n.opacity <= 1 && n.radius >= 0 && n.strokeWidth >= 0 && /^#[\da-f]{6}$/i.test(n.fill) && (n.stroke === null || /^#[\da-f]{6}$/i.test(n.stroke)); }
export function makeNode(type: Node['type'], x: number, y: number, index = between()): Node { return { id: crypto.randomUUID(), type, parent: null, index, name: type === 'frame' ? 'Frame' : type === 'rect' ? 'Rectangle' : 'Ellipse', x, y, w: 100, h: 100, fill: type === 'frame' ? '#ffffff' : '#ff4f00', stroke: null, strokeWidth: 1, radius: 0, opacity: 1 }; }
