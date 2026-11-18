import { children, type Doc, type Node, type Op } from './doc';
import { applyLayout } from './layout';

type Size = { w: number; h: number };
type Mode = 'start' | 'end' | 'both' | 'center' | 'scale';
const axis = (mode: Mode, pos: number, size: number, from: number, to: number): [number, number] => {
    const d = to - from;
    switch (mode) {
        case 'end': return [pos + d, size];
        case 'both': return [pos, Math.max(1, size + d)];
        case 'center': return [pos + d / 2, size];
        case 'scale': return from > 0 ? [pos * to / from, Math.max(1, size * to / from)] : [pos, size];
        default: return [pos, size];
    }
};
const modes: Record<string, Mode> = { left: 'start', top: 'start', right: 'end', bottom: 'end', both: 'both', center: 'center', scale: 'scale' };

/** New parent-relative box for a node whose parent frame went from `from` to `to`. */
export function constrain(n: Node, from: Size, to: Size, scale = false): Pick<Node, 'x' | 'y' | 'w' | 'h'> {
    const [x, w] = axis(scale ? 'scale' : modes[n.constraintH ?? 'left'], n.x, n.w, from.w, to.w);
    const [y, h] = axis(scale ? 'scale' : modes[n.constraintV ?? 'top'], n.y, n.h, from.h, to.h);
    const auto = n.type === 'text';
    return { x, y, w: auto && n.textWidth !== 'fixed' ? n.w : w, h: auto ? n.h : h };
}

/** Ops that lay out the subtree of `id` (as stored in `base`) after it is resized to `to`, skipping values `current` already holds. Frame children follow constraints; group children scale with the group; auto layout frames lay out their own children. */
export function constraintOps(base: Doc, id: string, to: Size, skip: (id: string) => boolean = () => false, current: Doc = base): Op[] {
    const parent = base.get(id);
    if (!parent) return [];
    const ops: Op[] = [];
    if (parent.layout === 'horizontal' || parent.layout === 'vertical') {
        const laid: Doc = new Map(base).set(id, { ...parent, ...to });
        applyLayout(laid, n => ({ w: n.w, h: n.h }));
        for (const c of children(base, id)) {
            const n = laid.get(c.id)!;
            if (!skip(c.id) && (c.type === 'frame' || c.type === 'group'))
                ops.push(...constraintOps(base, c.id, { w: n.w, h: n.h }, skip, current));
        }
        return ops;
    }
    for (const c of children(base, id)) {
        if (skip(c.id)) continue;
        const next = constrain(c, parent, to, parent.type === 'group'), now = current.get(c.id);
        for (const key of ['x', 'y', 'w', 'h'] as const) if (next[key] !== now?.[key]) ops.push({ t: 'set', id: c.id, key, value: next[key] });
        if (c.type === 'frame' || c.type === 'group') ops.push(...constraintOps(base, c.id, next, skip, current));
    }
    return ops;
}
