import { applyOp, descendants, type Doc, type Op, type Key } from '../shared/doc';
import { detachOps, resizeFollowOps } from '../shared/components';
function pendingKey(op: Op): string | undefined { return op.t === 'set' ? op.id + ':' + op.key : op.t === 'override' ? op.id + ':o:' + op.target + ':' + op.key : undefined; }
type Change = {
    before: Op;
    after: Op;
};
export class Store extends EventTarget {
    doc: Doc = new Map();
    selection = new Set<string>();
    pending = new Map<number, Op[]>();
    seq = 0;
    send: (ops: Op[], seq: number) => void = () => { };
    undoStack: Change[][] = [];
    redoStack: Change[][] = [];
    group: Change[] | null = null;
    changed() { this.dispatchEvent(new Event('change')); }
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
    commit(ops: Op[], record = true) { const changes: Change[] = [], queue = [...ops], sent: Op[] = [];
    const deleting = new Set(ops.flatMap(op => op.t === 'delete' ? [op.id, ...descendants(this.doc, op.id).map(n => n.id)] : []));
    const mains = deleting;
    if (mains.size) {
        const shadow = new Map(this.doc), prefix: Op[] = [];
        for (const n of this.doc.values()) {
            if (!n.instanceOf || !mains.has(n.instanceOf) || deleting.has(n.id)) continue;
            const detach = detachOps(shadow, n.id);
            prefix.push(...detach);
            for (const op of detach) applyOp(shadow, op);
        }
        queue.unshift(...prefix);
    }
    for (let i = 0; i < queue.length; i++) {
        const op = queue[i];
        const id = op.t === 'create' ? op.node.id : op.id, n = this.doc.get(id);
        if (op.t === 'delete' && n) {
            const mains = new Set([n, ...descendants(this.doc, n.id)].map(n => n.id));
            const instance = [...this.doc.values()].find(n => n.instanceOf && mains.has(n.instanceOf) && !deleting.has(n.id));
            if (instance) { queue.splice(i, 0, ...detachOps(this.doc, instance.id)); i--; continue; }
        }
        const removed = n && op.t === 'delete' ? [n, ...descendants(this.doc, n.id)] : [];
        const follow = record && n?.component && op.t === 'set' && (op.key === 'w' || op.key === 'h') ? resizeFollowOps(this.doc, n.id, op.key, n[op.key], op.value as number) : [];
        applyOp(this.doc, op);
        if (this.doc.get(id) === n)
            continue;
        sent.push(op);
        queue.splice(i + 1, 0, ...follow);
        if (op.t === 'create')
            changes.push({ before: { t: 'delete', id: op.node.id }, after: op });
        else if (n && op.t === 'set')
            changes.push({ before: { t: 'set', id: n.id, key: op.key, value: n[op.key] }, after: op });
        else if (n && op.t === 'override') {
            const value = n.overrides?.[op.target]?.[op.key];
            changes.push({ before: { ...op, value, clear: value === undefined ? true : undefined }, after: op });
        }
        else if (n && op.t === 'delete') {
            for (const child of removed.reverse())
                changes.push({ before: { t: 'create', node: { ...child } }, after: { t: 'delete', id: child.id } });
        }
    } if (record && changes.length) {
        if (this.group)
            this.group.push(...changes);
        else {
            this.undoStack.push(changes);
            this.redoStack = [];
        }
    } for (let i = 0; i < sent.length; i += 1000) {
        const batch = sent.slice(i, i + 1000);
        const seq = ++this.seq;
        this.pending.set(seq, batch);
        this.send(batch, seq);
    } this.changed(); return changes; }
    set(id: string, values: Partial<Record<Key, unknown>>) { this.commit(Object.entries(values).map(([key, value]) => ({ t: 'set', id, key, value }) as Op)); }
    remote(ops: Op[]) { const keys = new Set([...this.pending.values()].flat().map(pendingKey).filter(Boolean)); for (const op of ops)
        if (!pendingKey(op) || !keys.has(pendingKey(op)))
            applyOp(this.doc, op); this.changed(); }
    init(nodes: import('../shared/doc').Node[]) { this.doc = new Map(nodes.map(n => [n.id, n])); for (const ops of this.pending.values())
        for (const op of ops)
            applyOp(this.doc, op); this.changed(); }
    history(redo = false) { const from = redo ? this.redoStack : this.undoStack, to = redo ? this.undoStack : this.redoStack; const group = from.pop(); if (!group)
        return; const source = redo ? group : [...group].reverse(); const ops: Op[] = []; const shadow = new Map(this.doc); for (const c of source) {
        const expected = redo ? c.before : c.after, next = redo ? c.after : c.before;
        const n = expected.t === 'create' ? shadow.get(expected.node.id) : shadow.get(expected.id);
        if (expected.t === 'set' && n?.[expected.key] !== expected.value)
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
