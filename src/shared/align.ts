import { type Doc, type Node } from './doc';
import { bounds, world, type Rect } from './geometry';
import { blocked } from './layers';

export type Alignment = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom' | 'horizontal' | 'vertical' | 'tidy';
export interface Move { id: string; dx: number; dy: number; }
export function eligible(doc: Doc, ids: Iterable<string>): Node[] {
    const selected = new Set(ids);
    return [...selected].map(id => doc.get(id)).filter((n): n is Node => {
        if (!n || blocked(doc, n)) return false;
        let p = n.parent;
        while (p) { if (selected.has(p)) return false; p = doc.get(p)?.parent ?? null; }
        return true;
    });
}
const median = (values: number[]) => { const sorted = values.sort((a, b) => a - b), m = Math.floor(sorted.length / 2); return sorted.length ? Math.max(0, Math.round(sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2)) : 0; };
type Item = Rect & { id: string };
function clusters(items: Item[], axis: 'x' | 'y') {
    const size = axis === 'x' ? 'w' : 'h', groups: Item[][] = [];
    for (const item of [...items].sort((a, b) => a[axis] + a[size] / 2 - b[axis] - b[size] / 2)) {
        const group = groups.at(-1), first = group?.[0];
        if (first && Math.abs(item[axis] + item[size] / 2 - first[axis] - first[size] / 2) <= Math.min(item[size], first[size]) / 2) group!.push(item);
        else groups.push([item]);
    }
    return groups;
}
export function align(doc: Doc, ids: Iterable<string>, action: Alignment, rectOf: (doc: Doc, node: Node) => Rect = world): Move[] {
    const nodes = eligible(doc, ids), items = nodes.map(n => ({ id: n.id, ...rectOf(doc, n) }));
    if (!items.length) return [];
    const box = bounds(items), moves = new Map<string, Move>();
    const put = (n: Item, x: number, y: number) => moves.set(n.id, { id: n.id, dx: Math.round(x - n.x), dy: Math.round(y - n.y) });
    if (action === 'horizontal' || action === 'vertical') {
        if (items.length < 3) return [];
        const axis = action === 'horizontal' ? 'x' : 'y', size = axis === 'x' ? 'w' : 'h', sorted = [...items].sort((a, b) => a[axis] - b[axis]);
        const last = sorted.at(-1)!, gap = (last[axis] + last[size] - sorted[0][axis] - sorted.reduce((sum, n) => sum + n[size], 0)) / (items.length - 1);
        let pos = sorted[0][axis];
        sorted.forEach((n, i) => { if (i && i < sorted.length - 1) put(n, axis === 'x' ? pos : n.x, axis === 'y' ? pos : n.y); pos += n[size] + gap; });
    }
    else if (action === 'tidy') {
        if (items.length < 2) return [];
        let rows = clusters(items, 'y');
        const cols = clusters(items, 'x');
        if (cols.length === 1 && rows.length > 1) rows = [...items].sort((a, b) => a.y - b.y).map(n => [n]);
        else if (rows.length === items.length) rows = [[...items].sort((a, b) => a.x - b.x)];
        rows.forEach(row => row.sort((a, b) => a.x - b.x));
        const gapX = median(rows.flatMap(row => row.slice(1).map((n, i) => n.x - row[i].x - row[i].w)));
        const rowBoxes = rows.map(row => bounds(row));
        const gapY = median(rowBoxes.slice(1).map((r, i) => r.y - rowBoxes[i].y - rowBoxes[i].h));
        const widths = Array.from({ length: Math.max(...rows.map(row => row.length)) }, (_, i) => Math.max(...rows.map(row => row[i]?.w ?? 0)));
        let y = box.y;
        rows.forEach((row, i) => { let x = box.x; row.forEach((n, j) => { put(n, x, y); x += widths[j] + gapX; }); y += rowBoxes[i].h + gapY; });
    }
    else {
        const parent = nodes.length === 1 && nodes[0].parent ? doc.get(nodes[0].parent) : undefined;
        if (items.length === 1 && parent?.type !== 'frame') return [];
        const target = items.length === 1 ? rectOf(doc, parent!) : box;
        for (const n of items) put(n,
            action === 'left' ? target.x : action === 'hcenter' ? target.x + (target.w - n.w) / 2 : action === 'right' ? target.x + target.w - n.w : n.x,
            action === 'top' ? target.y : action === 'vmiddle' ? target.y + (target.h - n.h) / 2 : action === 'bottom' ? target.y + target.h - n.h : n.y);
    }
    return [...moves.values()].filter(m => m.dx || m.dy);
}
