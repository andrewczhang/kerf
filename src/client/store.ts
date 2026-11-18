import { applyOp, descendants, isTextNode, normalizeNode, normalizeRotation, layoutDefaults, type Doc, type Op, type Key } from '../shared/doc';
import { applyLayout, type MeasureText } from '../shared/layout';
import { detachOps, expand, resizeFollowOps, isVirtual, splitVirtual } from '../shared/components';
import { MAX_OPS } from '../shared/protocol';
import { migrationOps, pageDocument, pages } from '../shared/pages';
import { docIndex, indexDoc } from '../shared/doc-index';
function pendingKey(op: Op): string | undefined { return op.t === 'set' ? op.id + ':' + op.key : op.t === 'override' ? op.id + ':o:' + op.target + ':' + op.key : undefined; }
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const entries = Object.entries(a);
    return entries.length === Object.keys(b).length && entries.every(([key, value]) => Object.prototype.hasOwnProperty.call(b, key) && sameValue(value, (b as Record<string, unknown>)[key]));
}
type Change = {
    before: Op;
    after: Op;
};
export class Store extends EventTarget {
    constructor(public measureText?: MeasureText) { super(); }
    relayout() { applyLayout(this.doc, this.measureText); this.changed(); }
    readOnly = false;
    private document = indexDoc();
    get doc(): Doc { return this.document; }
    get treeRevision() { return docIndex(this.document)!.treeRevision; }
    set doc(doc: Doc) { this.document = indexDoc(doc); }
    private needsLayout(ops: Op[]) {
        return ops.some(op => {
            if (op.t !== 'set') return true;
            if (op.key !== 'x' && op.key !== 'y') return !['name', 'hidden', 'locked', 'link', 'fill', 'fills', 'effects', 'stroke', 'strokeWidth', 'radius', 'opacity', 'grids', 'constraintH', 'constraintV', 'strokeAlign', 'strokeCap', 'strokeJoin', 'strokeStart', 'strokeEnd', 'strokeDash', 'strokeGap', 'strokeMiterLimit'].includes(op.key);
            const n = this.doc.get(op.id), parent = n?.parent ? this.doc.get(n.parent) : undefined;
            return parent?.type === 'frame' && (parent.layout === 'horizontal' || parent.layout === 'vertical');
        });
    }
    selection = new Set<string>();
    pending = new Map<number, Op[]>();
    seq = 0;
    send: (ops: Op[], seq: number) => void = () => { };
    undoStack: Change[][] = [];
    redoStack: Change[][] = [];
    group: Change[] | null = null;
    pagesEnabled = false;
    currentPage?: string;
    private preferredPage?: string;
    private scoped?: Doc;
    get pageDoc() { return this.pagesEnabled ? this.scoped ??= indexDoc(pageDocument(this.doc, this.currentPage)) : this.doc; }
    enablePages(page?: string) { this.pagesEnabled = true; this.preferredPage = page; }
    setPage(id: string) { if (this.doc.get(id)?.type !== 'page' || id === this.currentPage) return; this.dispatchEvent(new Event('page-leave')); this.currentPage = id; this.selection.clear(); this.scoped = undefined; this.dispatchEvent(new Event('page-change')); this.changed(); }
    changed() {
        this.scoped = undefined;
        if (this.pagesEnabled) {
            const list = pages(this.doc), next = list.find(n => n.id === this.currentPage)?.id ?? list.find(n => n.id === this.preferredPage)?.id ?? list[0]?.id;
            if (next !== this.currentPage) { this.currentPage = next; this.selection.clear(); this.dispatchEvent(new Event('page-change')); }
            for (const id of this.selection) if (!this.pageDoc.has(isVirtual(id) ? splitVirtual(id).instance : id) || this.doc.get(id)?.type === 'page') this.selection.delete(id);
        }
        this.dispatchEvent(new Event('change'));
    }
    clearHistory() { this.undoStack = []; this.redoStack = []; this.group = null; }
    begin() { this.group = []; }
    end() { if (this.group?.length) {
        const merged: Change[] = [];
        const keys = new Map<string, Change>();
        for (const c of this.group) {
            const key = pendingKey(c.after);
            if (key) {
                const old = keys.get(key);
                if (old) {
                    old.after = c.after;
                    continue;
                }
                keys.set(key, c);
            }
            merged.push(c);
        }
        this.undoStack.push(merged);
        this.redoStack = [];
    } this.group = null; }
    commit(ops: Op[], record = true) {
        if (this.readOnly) return [];
        if (this.pagesEnabled && this.currentPage) ops = ops.map(op => op.t === 'create' && op.node.type !== 'page' && op.node.parent === null ? { ...op, node: { ...op.node, parent: this.currentPage! } } : op.t === 'set' && op.key === 'parent' && op.value === null && this.doc.get(op.id)?.type !== 'page' ? { ...op, value: this.currentPage! } : op);
        ops = ops.map(op => op.t === 'set' && op.key === 'rotation' && typeof op.value === 'number' && Number.isFinite(op.value) ? { ...op, value: this.doc.get(op.id)?.type === 'group' ? 0 : normalizeRotation(op.value) } : op);
        ops = ops.map(op => {
            if (op.t !== 'set' || !isVirtual(op.id) && !(this.doc.get(op.id)?.instanceOf && ['fills', 'effects', 'grids', 'constraintH', 'constraintV', ...Object.keys(layoutDefaults)].includes(op.key))) return op;
            const { instance, target } = splitVirtual(op.id);
            return { t: 'override', id: instance, target, key: op.key, value: op.value };
        });
        if (record) {
            const explicit = new Set(ops.flatMap(op => op.t === 'set' ? [op.id + ':' + op.key] : []));
            let resolved: Doc | undefined;
            ops = ops.flatMap(op => {
                if (op.t !== 'set' && op.t !== 'override') return [op];
                if (op.t === 'override' && (op.target || op.clear || op.value !== 'fixed' || !['sizeW', 'sizeH'].includes(op.key) || !this.doc.get(op.id)?.instanceOf)) return [op];
                const n = op.t === 'override' ? (resolved ??= expand(this.doc, this.measureText)).get(op.id) : this.doc.get(op.id);
                if (!n) return [op];
                const geometry: Op[] = [];
                const freeze = (key: 'w' | 'h', value: number) => {
                    if (!explicit.has(n.id + ':' + key)) geometry.push({ t: 'set', id: n.id, key, value });
                };
                if (isTextNode(n) && op.key === 'textWidth' && op.value === 'fixed' && n.textWidth !== 'fixed')
                    freeze('w', this.measureText?.(n).w ?? n.w);
                if (op.value === 'fixed') {
                    if (op.key === 'sizeW' && (n.sizeW === 'hug' || n.sizeW === 'fill')) freeze('w', n.w);
                    if (op.key === 'sizeH' && (n.sizeH === 'hug' || n.sizeH === 'fill') && !isTextNode(n)) freeze('h', n.h);
                }
                return [...geometry, op];
            });
        }
        const layout = this.needsLayout(ops);
        const changes: Change[] = [], queue = [...ops], sent: Op[] = [];
    const final = ops.some(op => op.t === 'delete') ? new Map(this.doc) : undefined;
    if (final) for (const op of ops) applyOp(final, op);
    const deleting = new Set(final ? [...this.doc.keys()].filter(id => !final.has(id)) : []);
    const mains = deleting;
    if (mains.size) {
        const shadow = new Map(this.doc), prefix: Op[] = [];
        for (const n of this.doc.values()) {
            if (!n.instanceOf || !mains.has(n.instanceOf) || deleting.has(n.id)) continue;
            const detach = detachOps(shadow, n.id, this.measureText);
            prefix.push(...detach);
            for (const op of detach) applyOp(shadow, op);
        }
        queue.unshift(...prefix);
    }
    for (let i = 0; i < queue.length; i++) {
        const op = queue[i];
        const id = op.t === 'create' ? op.node.id : op.id, n = this.doc.get(id);
        if (op.t === 'override' && op.key === 'closed') {
            const shadow = new Map(this.doc); applyOp(shadow, op);
            const target = expand(shadow, this.measureText).get(op.id + (op.target ? '/' + op.target : ''));
            if (target?.type === 'path' && !target.closed && target.mask) {
                queue.splice(i, 0, { t: 'override', id: op.id, target: op.target, key: 'mask', value: false }); i--; continue;
            }
        }
        if (op.t === 'delete' && n) {
            const mains = new Set([n, ...descendants(this.doc, n.id)].filter(n => !final!.has(n.id)).map(n => n.id));
            const instance = [...this.doc.values()].find(n => n.instanceOf && mains.has(n.instanceOf) && final!.has(n.id));
            if (instance) { queue.splice(i, 0, ...detachOps(this.doc, instance.id, this.measureText)); i--; continue; }
        }
        const removed = n && op.t === 'delete' ? [n, ...descendants(this.doc, n.id)] : [];
        const follow = record && n?.component && op.t === 'set' && (op.key === 'w' || op.key === 'h') ? resizeFollowOps(this.doc, n.id, op.key, n[op.key], op.value as number) : [];
        applyOp(this.doc, op);
        if (op.t !== 'override' || this.doc.get(id) !== n) sent.push(op);
        if (this.doc.get(id) === n)
            continue;
        queue.splice(i + 1, 0, ...follow);
        if (op.t === 'create')
            changes.push({ before: { t: 'delete', id: op.node.id }, after: op });
        else if (n && op.t === 'set') {
            const value = this.doc.get(n.id)?.[op.key];
            if (n[op.key] !== value) changes.push({ before: { t: 'set', id: n.id, key: op.key, value: n[op.key] }, after: { t: 'set', id: n.id, key: op.key, value } });
        }
        else if (n && op.t === 'override') {
            const value = n.overrides?.[op.target]?.[op.key];
            changes.push({ before: { ...op, value, clear: value === undefined ? true : undefined }, after: op });
        }
        else if (n && op.t === 'delete') {
            for (const child of removed.reverse())
                changes.push({ before: { t: 'create', node: { ...child } }, after: { t: 'delete', id: child.id } });
        }
    } const geometry = record && layout ? [...this.doc.values()].map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h })) : [];
    if (layout) applyLayout(this.doc, this.measureText);
    for (const before of geometry) {
        const after = this.doc.get(before.id)!;
        for (const key of ['x', 'y', 'w', 'h'] as const)
            if (before[key] !== after[key])
                changes.push({ before: { t: 'set', id: before.id, key, value: before[key] }, after: { t: 'set', id: before.id, key, value: after[key] } });
    } if (record && changes.length) {
        if (this.group)
            this.group.push(...changes);
        else {
            this.undoStack.push(changes);
            this.redoStack = [];
        }
    } for (let i = 0; i < sent.length; i += MAX_OPS) {
        const batch = sent.slice(i, i + MAX_OPS);
        const seq = ++this.seq;
        this.pending.set(seq, batch);
        this.send(batch, seq);
    } this.changed(); return changes; }
    set(id: string, values: Partial<Record<Key, unknown>>) { this.commit(Object.entries(values).map(([key, value]) => ({ t: 'set', id, key, value }) as Op)); }
    editText(id: string, baseText: string, value: string) {
        if (baseText !== value && isTextNode(this.doc.get(id))) this.commit([{ t: 'set', id, key: 'text', value, baseText }]);
    }
    remote(ops: Op[]) {
        const layout = this.needsLayout(ops);
        const pending = [...this.pending.values()].flat();
        const keys = new Set(pending.map(pendingKey).filter(Boolean));
        for (const op of ops) {
            if (op.t === 'set' && op.key === 'text') {
                applyOp(this.doc, op);
                for (const edit of pending)
                    if (edit.t === 'set' && edit.id === op.id && edit.key === 'text') applyOp(this.doc, edit);
            } else if (!pendingKey(op) || !keys.has(pendingKey(op)))
                applyOp(this.doc, op);
        }
        const resolved = [...this.selection].some(isVirtual) ? expand(this.doc, this.measureText) : this.doc;
        for (const id of this.selection)
            if (!resolved.has(id)) this.selection.delete(id);
        if (layout) applyLayout(this.doc, this.measureText);
        this.changed();
    }
    init(nodes: import('../shared/doc').Node[], replayPending = true) { this.doc = new Map(nodes.map(n => [n.id, normalizeNode(n)])); for (const ops of replayPending ? this.pending.values() : [])
        for (const op of ops)
            applyOp(this.doc, op); for (const id of this.selection) if (!this.doc.has(id)) this.selection.delete(id); applyLayout(this.doc, this.measureText); if (this.pagesEnabled && !this.readOnly) this.commit(migrationOps(this.doc), false); else this.changed(); }
    history(redo = false) { if (this.readOnly) return; const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack; const group = from.pop(); if (!group)
        return; const source = redo ? group : [...group].reverse(); const ops: Op[] = []; const shadow = new Map(this.doc);
        const created = new Set(group.flatMap(c => c.after.t === 'create' ? [c.after.node.id] : []));
        for (const c of source) {
        const expected = redo ? c.before : c.after, next = redo ? c.after : c.before;
        const n = expected.t === 'create' ? shadow.get(expected.node.id) : shadow.get(expected.id);
        if (!redo && expected.t === 'set' && created.has(expected.id))
            continue;
        if (expected.t === 'set' && !(expected.key === 'overrides' ? sameValue(n?.overrides, expected.value) : n?.[expected.key] === expected.value))
            continue;
        if (expected.t === 'override' && n?.overrides?.[expected.target]?.[expected.key] !== (expected.clear ? undefined : expected.value))
            continue;
        if (expected.t === 'create' && !n)
            continue;
        if (expected.t === 'delete' && n)
            continue;
        ops.push(next);
        applyOp(shadow, next);
    } const applied = this.commit(ops, false); if (applied.length)
        to.push(redo ? applied : applied.reverse().map(c => ({ before: c.after, after: c.before }))); }
}
