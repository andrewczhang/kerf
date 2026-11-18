import { applyOp, descendants, isTextNode, normalizeNode, normalizeRotation, type Doc, type Op, type Key } from '../shared/doc';
import { applyLayout, type MeasureText } from '../shared/layout';
import { MAX_OPS } from '../shared/protocol';
import { docIndex, indexDoc } from '../shared/doc-index';
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
    changed() { this.dispatchEvent(new Event('change')); }
    clearHistory() { this.undoStack = []; this.redoStack = []; this.group = null; }
    begin() { this.group = []; }
    end() { if (this.group?.length) {
        const merged: Change[] = [];
        const keys = new Map<string, Change>();
        for (const c of this.group) {
            if (c.after.t === 'set') {
                const key = c.after.id + ':' + c.after.key;
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
        if (this.readOnly) return;
        ops = ops.map(op => op.t === 'set' && op.key === 'rotation' && typeof op.value === 'number' && Number.isFinite(op.value) ? { ...op, value: this.doc.get(op.id)?.type === 'group' ? 0 : normalizeRotation(op.value) } : op);
        if (record) {
            const explicit = new Set(ops.flatMap(op => op.t === 'set' ? [op.id + ':' + op.key] : []));
            ops = ops.flatMap(op => {
                if (op.t !== 'set') return [op];
                const n = this.doc.get(op.id);
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
        const changes: Change[] = []; for (const op of ops) {
        const n = op.t === 'create' ? undefined : this.doc.get(op.id);
        if (op.t === 'create')
            changes.push({ before: { t: 'delete', id: op.node.id }, after: op });
        else if (n && op.t === 'set') {
            applyOp(this.doc, op);
            const value = this.doc.get(n.id)?.[op.key];
            if (n[op.key] !== value)
                changes.push({ before: { t: 'set', id: n.id, key: op.key, value: n[op.key] }, after: { t: 'set', id: n.id, key: op.key, value } });
            continue;
        }
        else if (n) {
            for (const child of [n, ...descendants(this.doc, n.id)].reverse())
                changes.push({ before: { t: 'create', node: { ...child } }, after: { t: 'delete', id: child.id } });
        }
        applyOp(this.doc, op);
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
    } for (let i = 0; i < ops.length; i += MAX_OPS) {
        const chunk = ops.slice(i, i + MAX_OPS);
        const seq = ++this.seq;
        this.pending.set(seq, chunk);
        this.send(chunk, seq);
    } this.changed(); }
    set(id: string, values: Partial<Record<Key, unknown>>) { this.commit(Object.entries(values).map(([key, value]) => ({ t: 'set', id, key, value }) as Op)); }
    editText(id: string, baseText: string, value: string) {
        if (baseText !== value && isTextNode(this.doc.get(id))) this.commit([{ t: 'set', id, key: 'text', value, baseText }]);
    }
    remote(ops: Op[]) {
        const layout = this.needsLayout(ops);
        const pending = [...this.pending.values()].flat().filter(op => op.t === 'set');
        const keys = new Set(pending.map(op => op.id + ':' + op.key));
        for (const op of ops) {
            if (op.t === 'set' && op.key === 'text') {
                applyOp(this.doc, op);
                for (const edit of pending)
                    if (edit.id === op.id && edit.key === 'text') applyOp(this.doc, edit);
            } else if (op.t !== 'set' || !keys.has(op.id + ':' + op.key))
                applyOp(this.doc, op);
        }
        for (const id of this.selection)
            if (!this.doc.has(id)) this.selection.delete(id);
        if (layout) applyLayout(this.doc, this.measureText);
        this.changed();
    }
    init(nodes: import('../shared/doc').Node[], replayPending = true) { this.doc = new Map(nodes.map(n => [n.id, normalizeNode(n)])); for (const ops of replayPending ? this.pending.values() : [])
        for (const op of ops)
            applyOp(this.doc, op); for (const id of this.selection) if (!this.doc.has(id)) this.selection.delete(id); applyLayout(this.doc, this.measureText); this.changed(); }
    history(redo = false) { if (this.readOnly) return; const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack; const group = from.pop(); if (!group)
        return; const source = redo ? group : [...group].reverse(); const ops: Op[] = [], accepted: Change[] = []; const shadow = new Map(this.doc);
        const created = new Set(group.flatMap(c => c.after.t === 'create' ? [c.after.node.id] : []));
        for (const c of source) {
        const expected = redo ? c.before : c.after, next = redo ? c.after : c.before;
        const n = expected.t === 'create' ? shadow.get(expected.node.id) : shadow.get(expected.id);
        if (!redo && expected.t === 'set' && created.has(expected.id))
            continue;
        if (expected.t === 'set' && n?.[expected.key] !== expected.value)
            continue;
        if (expected.t === 'create' && !n)
            continue;
        if (expected.t === 'delete' && n)
            continue;
        ops.push(next);
        if (!redo && expected.t === 'create' && n)
            for (const node of [n, ...descendants(shadow, n.id)].reverse())
                accepted.push({ before: { t: 'delete', id: node.id }, after: { t: 'create', node } });
        else accepted.push(c);
        applyOp(shadow, next);
    } this.commit(ops, false); if (accepted.length)
        to.push(redo ? accepted : accepted.reverse()); }
}
