import type { LayoutGrid } from './doc';
import type { Rect } from './geometry';
import type { RulerGuide } from './snap';

export function gridBands(r: Rect, g: LayoutGrid): Rect[] {
    if (g.type === 'grid') return [];
    const columns = g.type === 'columns', span = columns ? r.w : r.h;
    const size = (span - 2 * g.margin - (g.count - 1) * g.gutter) / g.count;
    if (size <= 0) return [];
    return Array.from({ length: g.count }, (_, i) => columns
        ? { x: r.x + g.margin + i * (size + g.gutter), y: r.y, w: size, h: r.h }
        : { x: r.x, y: r.y + g.margin + i * (size + g.gutter), w: r.w, h: size });
}

export function gridLines(r: Rect, g: LayoutGrid): RulerGuide[] {
    if (g.type !== 'grid') return gridBands(r, g).flatMap<RulerGuide>(b => g.type === 'columns'
        ? [{ axis: 'x' as const, position: b.x }, { axis: 'x' as const, position: b.x + b.w }]
        : [{ axis: 'y' as const, position: b.y }, { axis: 'y' as const, position: b.y + b.h }]);
    const lines: RulerGuide[] = [];
    if (!Number.isFinite(g.size) || g.size <= 0) return lines;
    for (const axis of ['x', 'y'] as const) {
        const span = axis === 'x' ? r.w : r.h;
        for (let i = 0; i <= Math.floor(span / g.size); i++) lines.push({ axis, position: r[axis] + i * g.size });
    }
    return lines;
}
