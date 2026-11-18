import { applyOp, type Doc, type Key, type Node, type Op } from './doc';
export interface Version { id: string; name: string; at: number; author: string; nodeCount: number; auto: boolean }
export function versionDiff(current: Doc, target: Doc): Op[] {
    const ops: Op[] = [], shadow = new Map(current);
    const push = (op: Op) => { ops.push(op); applyOp(shadow, op); };
    for (const n of current.values())
        if (target.has(n.id) && n.instanceOf !== target.get(n.id)!.instanceOf && shadow.has(n.id))
            push({ t: 'delete', id: n.id });
    const remaining = new Map(target);
    while (remaining.size) {
        let progress = false;
        for (const [id, n] of remaining) {
            if (n.parent && remaining.has(n.parent)) continue;
            if (!shadow.has(id)) push({ t: 'create', node: { ...n } });
            else for (const key of new Set([...Object.keys(shadow.get(id)!), ...Object.keys(n)])) {
                if (key === 'id') continue;
                const k = key as Key, value = k === 'link' ? n[k] ?? null : n[k];
                if ((k === 'link' ? shadow.get(id)![k] ?? null : shadow.get(id)![k]) !== value)
                    push({ t: 'set', id, key: k, value: value as Node[Key] });
            }
            remaining.delete(id); progress = true;
        }
        if (!progress) throw Error('Invalid snapshot hierarchy');
    }
    for (const n of current.values()) if (!target.has(n.id) && shadow.has(n.id)) push({ t: 'delete', id: n.id });
    return ops;
}
