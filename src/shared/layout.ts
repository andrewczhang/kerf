import { children, type Doc, type Node } from './doc';

function auto(n: Node): boolean { return n.type === 'frame' && (n.layout === 'horizontal' || n.layout === 'vertical'); }

export function applyLayout(doc: Doc): void {
    const lists = new Map<string | null, Node[]>();
    for (const n of doc.values()) {
        if (!lists.has(n.parent)) lists.set(n.parent, children(doc, n.parent));
    }
    const below = (n: Node) => lists.get(n.id) ?? [];
    const seen = new Set<string>();
    function hug(n: Node): void {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        const items = below(n);
        for (const c of items) hug(c);
        if (!auto(n) || !items.length) return;
        for (const axis of ['w', 'h'] as const) {
            if (n[axis === 'w' ? 'sizeW' : 'sizeH'] !== 'hug') continue;
            const main = (axis === 'w') === (n.layout === 'horizontal');
            const pads = axis === 'w' ? (n.padLeft ?? 0) + (n.padRight ?? 0) : (n.padTop ?? 0) + (n.padBottom ?? 0);
            const content = main ? items.reduce((sum, c) => sum + c[axis], 0) + (n.gap ?? 0) * (items.length - 1) : Math.max(...items.map(c => c[axis]));
            n[axis] = Math.max(1, pads + content);
        }
    }
    for (const n of doc.values()) hug(n);
    seen.clear();
    function place(n: Node): void {
        if (seen.has(n.id)) return;
        seen.add(n.id);
        const items = below(n);
        if (auto(n) && items.length) {
            const horizontal = n.layout === 'horizontal';
            const main = horizontal ? 'w' : 'h', cross = horizontal ? 'h' : 'w';
            const mainSize = horizontal ? 'sizeW' : 'sizeH', crossSize = horizontal ? 'sizeH' : 'sizeW';
            const start = (horizontal ? n.padLeft : n.padTop) ?? 0;
            const crossStart = (horizontal ? n.padTop : n.padLeft) ?? 0;
            const space = n[main] - start - ((horizontal ? n.padRight : n.padBottom) ?? 0);
            const crossSpace = n[cross] - crossStart - ((horizontal ? n.padBottom : n.padRight) ?? 0);
            let gap = n.gap ?? 0;
            const fills = items.filter(c => c[mainSize] === 'fill' && n[mainSize] !== 'hug');
            const fixed = items.filter(c => !fills.includes(c)).reduce((sum, c) => sum + c[main], 0);
            for (const c of items) {
                if (fills.includes(c)) c[main] = Math.max(1, (space - gap * (items.length - 1) - fixed) / fills.length);
                if (c[crossSize] === 'fill' && n[crossSize] !== 'hug') c[cross] = Math.max(1, crossSpace);
            }
            const spare = space - items.reduce((sum, c) => sum + c[main], 0) - gap * (items.length - 1);
            let cursor = start + (n.justify === 'center' ? spare / 2 : n.justify === 'end' ? spare : 0);
            if (n.justify === 'between' && items.length > 1) gap += spare / (items.length - 1);
            for (const c of items) {
                c[horizontal ? 'x' : 'y'] = cursor;
                c[horizontal ? 'y' : 'x'] = crossStart + (n.align === 'center' ? (crossSpace - c[cross]) / 2 : n.align === 'end' ? crossSpace - c[cross] : 0);
                cursor += c[main] + gap;
            }
        }
        for (const c of items) place(c);
    }
    for (const n of children(doc, null)) place(n);
    for (const n of doc.values()) place(n);
}
