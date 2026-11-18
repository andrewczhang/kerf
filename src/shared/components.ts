import { between, children, makeNode, overridable, type Doc, type Key, type Node, type Op } from './doc';

export function isVirtual(id: string): boolean { return id.includes('/'); }
export function splitVirtual(id: string): { instance: string; target: string } { const i = id.indexOf('/'); return i < 0 ? { instance: id, target: '' } : { instance: id.slice(0, i), target: id.slice(i + 1) }; }
function props(values: object | undefined): Partial<Node> { return Object.fromEntries(Object.entries(values ?? {}).filter(([key]) => overridable(key))); }
export function expand(doc: Doc): Doc {
    const out: Doc = new Map(doc);
    const resolve = (n: Node, seen: Set<string>): Node[] => {
        const main = n.instanceOf ? doc.get(n.instanceOf) : undefined;
        if (!main || seen.has(main.id) || seen.size >= 8)
            return [n];
        const path = new Set(seen).add(main.id);
        const root = { ...n, ...props(main), ...props(n.overrides?.['']), name: n.name };
        const result = [root];
        const walkMain = (parent: string, resolvedParent: string) => {
            for (const child of children(doc, parent)) {
                if (child.instanceOf) {
                    for (const value of resolve(child, path)) {
                        const suffix = value.id === child.id ? '' : value.id.slice(child.id.length);
                        const target = child.id + suffix;
                        result.push({ ...value, ...props(n.overrides?.[target]), id: n.id + '/' + target, parent: suffix ? n.id + '/' + value.parent : resolvedParent });
                    }
                }
                else {
                    result.push({ ...child, ...props(n.overrides?.[child.id]), id: n.id + '/' + child.id, parent: resolvedParent });
                    walkMain(child.id, n.id + '/' + child.id);
                }
            }
        };
        walkMain(main.id, n.id);
        return result;
    };
    for (const n of doc.values())
        if (n.instanceOf)
            for (const value of resolve(n, new Set()))
                out.set(value.id, value);
    return out;
}
export const componentOps = {
    create(doc: Doc, selectionIds: string[]): { ops: Op[]; id: string } {
        const nodes = [...new Set(selectionIds)].map(id => doc.get(id));
        if (!nodes.length || selectionIds.some(isVirtual) || nodes.some(n => !n || n.parent !== nodes[0]?.parent || (n.parent && doc.get(n.parent)?.instanceOf)))
            throw Error('Invalid component selection');
        const selected = nodes as Node[], first = selected[0];
        if (selected.length === 1 && first.type === 'frame' && !first.instanceOf)
            return { ops: [{ t: 'set', id: first.id, key: 'component', value: true }], id: first.id };
        const x = Math.min(...selected.map(n => n.x)), y = Math.min(...selected.map(n => n.y));
        const frame = { ...makeNode('frame', x, y, first.index), parent: first.parent, component: true, name: 'Component', w: Math.max(...selected.map(n => n.x + n.w)) - x, h: Math.max(...selected.map(n => n.y + n.h)) - y };
        const ops: Op[] = [{ t: 'create', node: frame }];
        for (const n of selected)
            ops.push({ t: 'set', id: n.id, key: 'parent', value: frame.id }, { t: 'set', id: n.id, key: 'x', value: n.x - x }, { t: 'set', id: n.id, key: 'y', value: n.y - y });
        return { ops, id: frame.id };
    }
};
export function instanceNode(main: Node, x: number, y: number, parent: string | null = null, index = between()): Node {
    const { component, overrides, ...values } = main;
    return { ...values, id: crypto.randomUUID(), type: 'frame', instanceOf: main.id, x, y, parent, index };
}
export function detachOps(doc: Doc, instanceId: string): Op[] {
    if (!doc.get(instanceId)?.instanceOf)
        return [];
    const expanded = expand(doc), root = expanded.get(instanceId)!;
    const nodes: Node[] = [];
    const walk = (n: Node) => { nodes.push(n); for (const c of children(expanded, n.id)) walk(c); };
    walk(root);
    const ids = new Map(nodes.map(n => [n.id, n.id === instanceId ? instanceId : crypto.randomUUID()]));
    return [{ t: 'delete', id: instanceId }, ...nodes.map(n => {
        const { instanceOf, overrides, component, ...values } = n;
        return { t: 'create' as const, node: { ...values, id: ids.get(n.id)!, parent: ids.get(n.parent!) ?? n.parent } };
    })];
}
export function resizeFollowOps(doc: Doc, mainId: string, key: 'w' | 'h', oldValue: number, newValue: number): Op[] {
    return [...doc.values()].filter(n => n.instanceOf === mainId && n[key] === oldValue).map(n => ({ t: 'set', id: n.id, key, value: newValue }));
}
