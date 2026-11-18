import { align, type Alignment } from '../shared/align';
import { normalizeGroups } from '../shared/layers';
import type { Op } from '../shared/doc';
import type { Store } from './store';
import { inverse, parentMatrix, transform } from '../shared/geometry';
import { aabb, sizeOf } from './geometry';

export function applyAlignment(store: Store, action: Alignment) {
    const moves = align(store.doc, store.selection, action, aabb);
    if (!moves.length) return;
    const ops: Op[] = moves.flatMap(m => { const n = store.doc.get(m.id)!, matrix = inverse(parentMatrix(store.doc, n, sizeOf)), a = transform(matrix, { x: 0, y: 0 }), b = transform(matrix, { x: m.dx, y: m.dy }); return [{ t: 'set', id: n.id, key: 'x', value: n.x + b.x - a.x }, { t: 'set', id: n.id, key: 'y', value: n.y + b.y - a.y }]; });
    store.begin();
    store.commit(ops);
    store.commit(normalizeGroups(store.doc, sizeOf));
    store.end();
}
export function alignmentKey(e: KeyboardEvent, store: Store) {
    if (!e.altKey || e.metaKey) return false;
    let action: Alignment | undefined;
    if (e.ctrlKey) { if (!e.shiftKey && e.code === 'KeyT') action = 'tidy'; }
    else if (e.shiftKey) { if (e.code === 'KeyH') action = 'horizontal'; if (e.code === 'KeyV') action = 'vertical'; }
    else action = ({ KeyA: 'left', KeyH: 'hcenter', KeyD: 'right', KeyW: 'top', KeyV: 'vmiddle', KeyS: 'bottom' } as Record<string, Alignment>)[e.code];
    if (!action) return false;
    e.preventDefault();
    applyAlignment(store, action);
    return true;
}
