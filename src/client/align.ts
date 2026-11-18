import { align, type Alignment } from '../shared/align';
import { normalizeGroups } from '../shared/layers';
import type { Op } from '../shared/doc';
import type { Store } from './store';
import { world } from './geometry';

export function applyAlignment(store: Store, action: Alignment) {
    const moves = align(store.doc, store.selection, action, world);
    if (!moves.length) return;
    const ops: Op[] = moves.flatMap(m => { const n = store.doc.get(m.id)!; return [{ t: 'set', id: n.id, key: 'x', value: n.x + m.dx }, { t: 'set', id: n.id, key: 'y', value: n.y + m.dy }]; });
    store.begin();
    store.commit(ops);
    store.commit(normalizeGroups(store.doc));
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
