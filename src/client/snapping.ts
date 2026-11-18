import { descendants } from '../shared/doc';
import { gridLines } from '../shared/layout-grid';
import { blocked } from '../shared/layers';
import { bounds, intersects, transform, type Rect } from '../shared/geometry';
import { aabb as world, worldMatrix } from './geometry';
import { nearestDistances, resizeSnap, snapRect, type Edges, type Guide, type Distance, type RulerGuide } from '../shared/snap';
import type { Context } from './tools/tool';
export interface SnapState { guides: Guide[]; measure: Distance[]; rulers: boolean; grid: boolean; lines: RulerGuide[]; layoutGrids?: boolean }
const exactSnaps = new WeakSet<Context>();
export function roundUnlessSnapped(ctx: Context, value: number): number { return exactSnaps.has(ctx) ? value : Math.round(value); }
export function selectionBox(ctx: Context) { const rs = [...ctx.store.selection].flatMap(id => { const n = ctx.store.doc.get(id); return n ? [world(ctx.store.doc, n)] : []; }); return rs.length ? bounds(rs) : undefined; }
function excludedSelection(ctx: Context) {
    const excluded = new Set(ctx.store.selection);
    for (const id of ctx.store.selection) for (const n of descendants(ctx.store.doc, id)) excluded.add(n.id);
    return excluded;
}
export function targets(ctx: Context) {
    const excluded = excludedSelection(ctx);
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
export function clearSnap(ctx: Context) { exactSnaps.delete(ctx); if (ctx.snap) { ctx.snap.guides = []; ctx.snap.measure = []; ctx.invalidate(); } }
export function snapped(ctx: Context, r: Rect, e: PointerEvent, edges?: Edges, center = false): Rect {
    if (!ctx.snap || e.ctrlKey || e.metaKey) { clearSnap(ctx); return r; }
    const ts = targets(ctx), state = ctx.snap;
    const lines = [...state.lines];
    const excluded = excludedSelection(ctx);
    if (state.layoutGrids !== false) for (const n of ctx.store.doc.values()) {
        if (n.type !== 'frame' || excluded.has(n.id) || blocked(ctx.store.doc, n, false)) continue;
        const frame = world(ctx.store.doc, n);
        let left = frame.x, top = frame.y, right = frame.x + frame.w, bottom = frame.y + frame.h;
        let parent = n.parent;
        const seen = new Set([n.id]);
        while (parent && !seen.has(parent)) {
            seen.add(parent);
            const p = ctx.store.doc.get(parent);
            if (!p) break;
            if (p.type === 'frame') {
                const clip = world(ctx.store.doc, p);
                left = Math.max(left, clip.x); top = Math.max(top, clip.y);
                right = Math.min(right, clip.x + clip.w); bottom = Math.min(bottom, clip.y + clip.h);
            }
            parent = p.parent;
        }
        if (right <= left || bottom <= top || r.x < left || r.y < top || r.x > right || r.y > bottom) continue;
        const m = worldMatrix(ctx.store.doc, n);
        for (const g of n.grids ?? []) if (g.visible) for (const l of gridLines({ x: 0, y: 0, w: n.w, h: n.h }, g, ctx.viewport.zoom)) {
            const a = transform(m, l.axis === 'x' ? { x: l.position, y: 0 } : { x: 0, y: l.position });
            const b = transform(m, l.axis === 'x' ? { x: l.position, y: n.h } : { x: n.w, y: l.position });
            if (Math.abs(a.x - b.x) < 1e-7 && a.x >= left && a.x <= right) lines.push({ axis: 'x', position: a.x });
            else if (Math.abs(a.y - b.y) < 1e-7 && a.y >= top && a.y <= bottom) lines.push({ axis: 'y', position: a.y });
        }
    }
    let result: Rect;
    let spacing: Distance[] = [];
    if (edges) { const s = resizeSnap(r, ts, 6 / ctx.viewport.zoom, edges, state.grid, lines, { center, aspect: e.shiftKey }); result = s.rect; state.guides = s.guides; }
    else { const s = snapRect(r, ts, 6 / ctx.viewport.zoom, state.grid, lines); result = { ...r, x: r.x + s.dx, y: r.y + s.dy }; state.guides = s.guides; spacing = s.spacing; }
    if (state.guides.length || spacing.length) exactSnaps.add(ctx); else exactSnaps.delete(ctx);
    state.measure = [...spacing, ...nearestDistances(result, ts).filter(d => !spacing.some(s => d.x1 === s.x1 && d.x2 === s.x2 && d.y1 === s.y1 && d.y2 === s.y2))];
    return result;
}
