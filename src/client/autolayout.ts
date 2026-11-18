import { between, children, makeNode, type Node, type Op } from '../shared/doc';
import { bounds, world } from '../shared/geometry';
import type { Store } from './store';

export function isAutoLayout(n: Node | undefined): boolean {
    return n?.type === 'frame' && (n.layout === 'horizontal' || n.layout === 'vertical');
}

function layoutOps(frame: Node, items: Node[]): Op[] {
    const set = (n: Node, key: keyof Omit<Node, 'id'>, value: Node[typeof key]): Op => ({ t: 'set', id: n.id, key, value });
    if (!items.length) return Object.entries({ layout: 'vertical', gap: 10, padTop: 10, padRight: 10, padBottom: 10, padLeft: 10, sizeW: 'fixed', sizeH: 'fixed' }).map(([key, value]) => set(frame, key as 'layout', value as Node['layout']));
    const spread = (axis: 'x' | 'y') => Math.max(...items.map(n => n[axis])) - Math.min(...items.map(n => n[axis]));
    const horizontal = spread('x') > spread('y'), axis = horizontal ? 'x' : 'y', size = horizontal ? 'w' : 'h';
    const ordered = [...items].sort((a, b) => a[axis] - b[axis] || (a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id)));
    let index: string | null = null;
    const ops = ordered.map(n => { index = between(index); return set(n, 'index', index); });
    const round = (v: number) => Math.max(0, Math.round(v));
    const gap = ordered.length > 1 ? round(ordered.slice(1).reduce((sum, n, i) => sum + n[axis] - ordered[i][axis] - ordered[i][size], 0) / (ordered.length - 1)) : 0;
    const box = bounds(items);
    const values = { layout: horizontal ? 'horizontal' : 'vertical', gap, padLeft: round(box.x), padTop: round(box.y), padRight: round(frame.w - box.x - box.w), padBottom: round(frame.h - box.y - box.h), sizeW: 'hug', sizeH: 'hug' };
    return [...ops, ...Object.entries(values).map(([key, value]) => set(frame, key as 'layout', value as Node['layout']))];
}

function grouped(store: Store, ops: Op[]): void {
    const own = store.group === null;
    if (own) store.begin();
    try { store.commit(ops); } finally { if (own) store.end(); }
}

export function addAutoLayout(store: Store, frame: Node): void {
    if (frame.type !== 'frame' || isAutoLayout(frame)) return;
    grouped(store, layoutOps(frame, children(store.doc, frame.id)));
}

export function wrapInAutoLayout(store: Store, nodes: Node[]): Node | undefined {
    const selected = new Set(nodes.map(n => n.id));
    const items = nodes.filter(n => {
        let p = n.parent;
        while (p) { if (selected.has(p)) return false; p = store.doc.get(p)?.parent ?? null; }
        return true;
    });
    if (!items.length) return;
    let parent = items[0].parent;
    const ancestors = (n: Node) => { const ids = new Set<string | null>([null]); let p = n.parent; while (p) { ids.add(p); p = store.doc.get(p)?.parent ?? null; } return ids; };
    for (const n of items) { const ids = ancestors(n); while (parent && !ids.has(parent)) parent = store.doc.get(parent)?.parent ?? null; }
    const box = bounds(items.map(n => world(store.doc, n)));
    const origin = parent ? world(store.doc, store.doc.get(parent)!) : { x: 0, y: 0 };
    const first = [...items].sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id))[0];
    const frame = { ...makeNode('frame', box.x - origin.x, box.y - origin.y, first.index), parent, w: Math.max(1, box.w), h: Math.max(1, box.h) };
    const copies = items.map(n => { const r = world(store.doc, n); return { ...n, parent: frame.id, x: r.x - box.x, y: r.y - box.y }; });
    const ops: Op[] = [{ t: 'create', node: frame }];
    for (const n of copies) for (const key of ['parent', 'x', 'y'] as const) ops.push({ t: 'set', id: n.id, key, value: n[key] });
    ops.push(...layoutOps(frame, copies));
    grouped(store, ops);
    store.selection.clear(); store.selection.add(frame.id); store.changed();
    return store.doc.get(frame.id);
}
