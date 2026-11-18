import { applyOp, between, children, childIndex, makeNode, overridable, type Doc, type Key, type Node, type Op } from './doc';
import { applyLayout, type MeasureText } from './layout';
import { constraintOps } from './constraints';

export function isVirtual(id: string): boolean { return id.includes('/'); }
export function splitVirtual(id: string): { instance: string; target: string } { const i = id.indexOf('/'); return i < 0 ? { instance: id, target: '' } : { instance: id.slice(0, i), target: id.slice(i + 1) }; }
function props(values: object | undefined, target = ''): Partial<Node> { return Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => overridable(key, target))); }
export function expand(doc: Doc, measure?: MeasureText): Doc {
    const out: Doc = new Map(doc);
    const tree = childIndex(doc);
    const resolve = (n: Node, seen: Set<string>): Node[] => {
        const main = n.instanceOf ? doc.get(n.instanceOf) : undefined;
        if (!main || seen.has(main.id) || seen.size >= 8)
            return [n];
        const path = new Set(seen).add(main.id);
        const root = { ...n, ...props(main), hidden: n.hidden, locked: n.locked, ...props(n.overrides?.['']), name: n.name, rotation: n.rotation ?? 0 };
        const result: Node[] = [root];
        const walkMain = (parent: string, resolvedParent: string) => {
            for (const child of tree.get(parent) ?? []) {
                if (child.instanceOf) {
                    for (const value of resolve(child, path)) {
                        const suffix = value.id === child.id ? '' : value.id.slice(child.id.length);
                        const target = child.id + suffix;
                        result.push({ ...value, ...props(n.overrides?.[target], target), id: n.id + '/' + target, parent: suffix ? n.id + '/' + value.parent : resolvedParent });
                    }
                }
                else {
                    result.push({ ...child, ...props(n.overrides?.[child.id], child.id), id: n.id + '/' + child.id, parent: resolvedParent });
                    walkMain(child.id, n.id + '/' + child.id);
                }
            }
        };
        walkMain(main.id, n.id);
        if (root.layout !== 'horizontal' && root.layout !== 'vertical' && (root.w !== main.w || root.h !== main.h)) {
            const base: Doc = new Map(result.map(n => [n.id, n]));
            base.set(root.id, { ...root, w: main.w, h: main.h });
            for (const op of constraintOps(base, root.id, root))
                if (op.t === 'set') base.set(op.id, { ...base.get(op.id)!, [op.key]: op.value });
            return result.map(n => n.id === root.id ? root : base.get(n.id)!);
        }
        return result;
    };
    for (const n of doc.values())
        if (n.instanceOf && !isVirtual(n.id))
            for (const value of resolve(n, new Set()))
                out.set(value.id, value);
    applyLayout(out, measure);
    return out;
}
export const componentOps = {
    create(doc: Doc, selectionIds: string[], sizeOf: (node: Node) => { w: number; h: number } = node => node): { ops: Op[]; id: string } {
        const nodes = [...new Set(selectionIds)].map(id => doc.get(id));
        if (!nodes.length || selectionIds.some(isVirtual) || nodes.some(n => !n || n.parent !== nodes[0]?.parent || (n.parent && doc.get(n.parent)?.instanceOf)))
            throw Error('Invalid component selection');
        const selected = nodes as Node[], first = selected[0];
        if (selected.length === 1 && first.type === 'frame' && !first.instanceOf)
            return { ops: [{ t: 'set', id: first.id, key: 'component', value: true }], id: first.id };
        const x = Math.min(...selected.map(n => n.x)), y = Math.min(...selected.map(n => n.y));
        const sizes = selected.map(sizeOf);
        const frame = { ...makeNode('frame', x, y, first.index), parent: first.parent, component: true, name: 'Component', w: Math.max(1, Math.max(...selected.map((n, i) => n.x + sizes[i].w)) - x), h: Math.max(1, Math.max(...selected.map((n, i) => n.y + sizes[i].h)) - y) };
        const ops: Op[] = [{ t: 'create', node: frame }];
        const shadow = new Map(doc);
        applyOp(shadow, ops[0]);
        if (shadow.size === doc.size) return { ops: [], id: frame.id };
        for (const n of selected)
            ops.push({ t: 'set', id: n.id, key: 'parent', value: frame.id }, { t: 'set', id: n.id, key: 'x', value: n.x - x }, { t: 'set', id: n.id, key: 'y', value: n.y - y });
        return { ops, id: frame.id };
    }
};
export function instanceNode(main: Node, x: number, y: number, parent: string | null = null, index = between()): Node {
    return { ...makeNode('frame', x, y, index), name: main.name, instanceOf: main.id, parent, w: main.w, h: main.h, rotation: 0 };
}
export function detachOps(doc: Doc, instanceId: string | string[], measure?: MeasureText): Op[] {
    if (Array.isArray(instanceId)) {
        const shadow = new Map(doc), ops: Op[] = [];
        for (const id of instanceId) {
            const detach = detachOps(shadow, id, measure);
            for (const op of detach) applyOp(shadow, op);
            ops.push(...detach);
        }
        return ops;
    }
    if (!doc.get(instanceId)?.instanceOf)
        return [];
    const expanded = expand(doc, measure), root = expanded.get(instanceId)!;
    const nodes: Node[] = [], tree = childIndex(expanded);
    const walk = (n: Node) => { nodes.push(n); for (const c of tree.get(n.id) ?? []) walk(c); };
    walk(root);
    const ids = new Map(nodes.map(n => [n.id, n.id === instanceId ? instanceId : crypto.randomUUID()]));
    const ops: Op[] = [{ t: 'delete', id: instanceId }, ...nodes.map(n => {
        const { instanceOf, overrides, component, ...values } = n;
        return { t: 'create' as const, node: { ...values, id: ids.get(n.id)!, parent: ids.get(n.parent!) ?? n.parent } };
    })];
    for (const n of doc.values()) {
        if (!n.instanceOf || n.id === instanceId || !n.overrides) continue;
        let changed = false;
        const overrides = Object.fromEntries(Object.entries(n.overrides).map(([target, values]) => {
            const parts = target.split('/'), i = parts.indexOf(instanceId);
            const mapped = i < 0 ? undefined : ids.get(parts.slice(i).join('/'));
            if (!mapped || mapped === instanceId || !expanded.has(n.id + '/' + target)) return [target, values];
            changed = true;
            return [[...parts.slice(0, i), mapped].join('/'), values];
        }));
        if (changed) ops.push({ t: 'set', id: n.id, key: 'overrides', value: overrides });
    }
    return ops;
}
export function resizeFollowOps(doc: Doc, mainId: string, key: 'w' | 'h', oldValue: number, newValue: number): Op[] {
    return [...doc.values()].filter(n => n.instanceOf === mainId && n[key] === oldValue).map(n => ({ t: 'set', id: n.id, key, value: newValue }));
}
