import { descendants } from '../shared/doc';
import { bounds, intersects, world, type Rect } from '../shared/geometry';
import { nearestDistances, resizeSnap, snapRect, type Edges, type Guide, type Distance, type RulerGuide } from '../shared/snap';
import type { Context } from './tools/tool';
export interface SnapState { guides: Guide[]; measure: Distance[]; rulers: boolean; grid: boolean; lines: RulerGuide[] }
export function selectionBox(ctx: Context) { const rs = [...ctx.store.selection].flatMap(id => { const n = ctx.store.doc.get(id); return n ? [world(ctx.store.doc, n)] : []; }); return rs.length ? bounds(rs) : undefined; }
export function targets(ctx: Context) {
    const excluded = new Set(ctx.store.selection);
    for (const id of ctx.store.selection) for (const n of descendants(ctx.store.doc, id)) excluded.add(n.id);
    return [...ctx.store.doc.values()].filter(n => {
        if (excluded.has(n.id) || n.opacity === 0) return false;
        const r = world(ctx.store.doc, n), seen = new Set([n.id]);
        let parent = n.parent;
        while (parent && !seen.has(parent)) {
            seen.add(parent); const p = ctx.store.doc.get(parent);
            if (!p) break;
            if (p.opacity === 0 || !intersects(r, world(ctx.store.doc, p))) return false;
            parent = p.parent;
        }
        return true;
    }).map(n => world(ctx.store.doc, n));
}
export function clearSnap(ctx: Context) { if (ctx.snap) { ctx.snap.guides = []; ctx.snap.measure = []; ctx.invalidate(); } }
export function snapped(ctx: Context, r: Rect, e: PointerEvent, edges?: Edges, center = false): Rect {
    if (!ctx.snap || e.ctrlKey || e.metaKey) { clearSnap(ctx); return r; }
    const ts = targets(ctx), state = ctx.snap;
    let result: Rect;
    if (edges) { const s = resizeSnap(r, ts, 6 / ctx.viewport.zoom, edges, state.grid, state.lines, { center, aspect: e.shiftKey }); result = s.rect; state.guides = s.guides; }
    else { const s = snapRect(r, ts, 6 / ctx.viewport.zoom, state.grid, state.lines); result = { ...r, x: r.x + s.dx, y: r.y + s.dy }; state.guides = s.guides; }
    state.measure = nearestDistances(result, ts);
    return result;
}
