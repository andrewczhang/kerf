import { between, children, descendants, isTextNode, makeNode, type Doc, type Node, type Op } from '../shared/doc';
import { bounds, contains, intersects, world, type Point } from '../shared/geometry';
import type { Store } from './store';

export function isAutoLayout(n: Node | undefined): boolean {
    return n?.type === 'frame' && (n.layout === 'horizontal' || n.layout === 'vertical');
}

export interface LayoutInsertion { parent: string; slot: number; from: Point; to: Point; }
export const layoutInsertions = new WeakMap<Store, LayoutInsertion>();

export function insertionSlot(doc: Doc, parent: Node, pointer: Point, moving: ReadonlySet<string> = new Set()): LayoutInsertion {
    const items = children(doc, parent.id).filter(n => !moving.has(n.id));
    const r = world(doc, parent), horizontal = parent.layout === 'horizontal';
    const axis = horizontal ? 'x' : 'y', size = horizontal ? 'w' : 'h';
    const local = pointer[axis] - r[axis];
    let slot = items.findIndex(n => local < n[axis] + n[size] / 2);
    if (slot < 0) slot = items.length;
    const before = items[slot - 1], after = items[slot];
    const position = before && after ? (before[axis] + before[size] + after[axis]) / 2 : before ? before[axis] + before[size] : after ? after[axis] : (horizontal ? parent.padLeft : parent.padTop) ?? 0;
    const from = horizontal ? { x: r.x + position, y: r.y + (parent.padTop ?? 0) } : { x: r.x + (parent.padLeft ?? 0), y: r.y + position };
    const to = horizontal ? { x: from.x, y: r.y + r.h - (parent.padBottom ?? 0) } : { x: r.x + r.w - (parent.padRight ?? 0), y: from.y };
    return { parent: parent.id, slot, from, to };
}

export function eligibleDropFrames(doc: Doc, nodes: Node[], pointer: Point, start: Point, movingNodes = nodes): Node[] {
    const moving = new Set(movingNodes.flatMap(n => [n.id, ...descendants(doc, n.id).map(c => c.id)]));
    return [...doc.values()].filter(frame => {
        const target = world(doc, frame);
        return frame.type === 'frame' && !moving.has(frame.id) && contains(target, pointer) && nodes.every(original => {
            const n = doc.get(original.id)!;
            if (n.type !== 'frame' || frame.parent !== n.parent) return true;
            const r = isAutoLayout(doc.get(original.parent ?? '')) ? world(doc, { ...original, x: original.x + pointer.x - start.x, y: original.y + pointer.y - start.y }) : world(doc, n);
            return r.x >= target.x && r.y >= target.y && r.x + r.w <= target.x + target.w && r.y + r.h <= target.y + target.h && (r.w < target.w || r.h < target.h);
        });
    });
}

export function dragInsertion(doc: Doc, nodes: Node[], pointer: Point, start: Point): LayoutInsertion | undefined {
    const moving = new Set(nodes.flatMap(n => [n.id, ...descendants(doc, n.id).map(c => c.id)]));
    const frames = eligibleDropFrames(doc, nodes, pointer, start);
    frames.sort((a, b) => descendants(doc, a.id).length - descendants(doc, b.id).length);
    let parent = frames[0];
    if (!isAutoLayout(parent) && nodes.length && nodes.every(n => n.parent === nodes[0].parent)) {
        const origin = doc.get(nodes[0].parent ?? '');
        if (isAutoLayout(origin) && nodes.some(n => {
            const r = world(doc, n);
            return intersects({ ...r, x: r.x + pointer.x - start.x, y: r.y + pointer.y - start.y }, world(doc, origin!));
        })) parent = origin!;
    }
    return isAutoLayout(parent) ? insertionSlot(doc, parent, pointer, moving) : undefined;
}

export function reorderInAutoLayout(store: Store, nodes: Node[], insertion: LayoutInsertion): void {
    const parent = store.doc.get(insertion.parent);
    if (!isAutoLayout(parent) || !nodes.length || nodes.some(n => n.id === parent!.id || descendants(store.doc, n.id).some(c => c.id === parent!.id))) return;
    const moving = new Set(nodes.map(n => n.id));
    const items = children(store.doc, parent!.id).filter(n => !moving.has(n.id));
    const slot = Math.max(0, Math.min(items.length, insertion.slot));
    let index = items[slot - 1]?.index ?? null;
    const next = items[slot]?.index ?? null;
    const ordered = [...nodes].sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id));
    const ops: Op[] = [];
    for (const n of ordered) {
        index = between(index, next);
        ops.push({ t: 'set', id: n.id, key: 'parent', value: parent!.id }, { t: 'set', id: n.id, key: 'index', value: index });
    }
    grouped(store, ops);
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
    const sizeOf = (n: Node) => isTextNode(n) && store.measureText ? store.measureText(n) : n;
    const measuredWorld = (n: Node) => world(store.doc, n, sizeOf);
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
    const box = bounds(items.map(measuredWorld));
    const origin = parent ? measuredWorld(store.doc.get(parent)!) : { x: 0, y: 0 };
    const first = [...items].sort((a, b) => a.index < b.index ? -1 : a.index > b.index ? 1 : a.id.localeCompare(b.id))[0];
    const frame = { ...makeNode('frame', box.x - origin.x, box.y - origin.y, first.index), parent, w: Math.max(1, box.w), h: Math.max(1, box.h) };
    const copies = items.map(n => { const r = measuredWorld(n); return { ...n, w: r.w, h: r.h, parent: frame.id, x: r.x - box.x, y: r.y - box.y }; });
    const ops: Op[] = [{ t: 'create', node: frame }];
    for (const n of copies) for (const key of ['parent', 'x', 'y'] as const) ops.push({ t: 'set', id: n.id, key, value: n[key] });
    ops.push(...layoutOps(frame, copies));
    grouped(store, ops);
    store.selection.clear(); store.selection.add(frame.id); store.changed();
    return store.doc.get(frame.id);
}
