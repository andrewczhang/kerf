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
    component?: boolean;
    instanceOf?: string;
    overrides?: Record<string, Partial<Record<Key, unknown>>>;
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
export function descendants(doc: Doc, id: string): Node[] { return children(doc, id).flatMap(n => [n, ...descendants(doc, n.id)]); }
export function applyOp(doc: Doc, op: Op): void {
    if (!op || !['create', 'set', 'delete', 'override'].includes(op.t))
        return;
    if (op.t === 'create') {
        if (!doc.has(op.node.id) && validNode(op.node) && validParent(doc, op.node) && (!op.node.instanceOf || !componentCycle(doc, op.node)))
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
            if (!validNode({ ...n, [op.key]: op.value }))
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
    if (!['type', 'parent', 'index', 'name', 'x', 'y', 'w', 'h', 'fill', 'stroke', 'strokeWidth', 'radius', 'opacity', 'component'].includes(op.key))
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
export function validNode(n: Node): boolean { return !!n && (n.component === undefined || typeof n.component === 'boolean') && (n.instanceOf === undefined || typeof n.instanceOf === 'string') && (n.overrides === undefined || (!!n.overrides && Object.getPrototypeOf(n.overrides) === Object.prototype)) && typeof n.id === 'string' && ['frame', 'rect', 'ellipse'].includes(n.type) && typeof n.index === 'string' && typeof n.name === 'string' && (n.parent === null || typeof n.parent === 'string') && ['x', 'y', 'w', 'h', 'strokeWidth', 'radius', 'opacity'].every(k => Number.isFinite(n[k as keyof Node])) && n.w >= 1 && n.h >= 1 && n.opacity >= 0 && n.opacity <= 1 && n.radius >= 0 && n.strokeWidth >= 0 && /^#[\da-f]{6}$/i.test(n.fill) && (n.stroke === null || /^#[\da-f]{6}$/i.test(n.stroke)); }
export function makeNode(type: Node['type'], x: number, y: number, index = between()): Node { return { id: crypto.randomUUID(), type, parent: null, index, name: type === 'frame' ? 'Frame' : type === 'rect' ? 'Rectangle' : 'Ellipse', x, y, w: 100, h: 100, fill: type === 'frame' ? '#ffffff' : '#ff4f00', stroke: null, strokeWidth: 1, radius: 0, opacity: 1 }; }
