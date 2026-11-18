import { expect, it, vi } from 'vitest';
import { childIndex, makeNode, type Doc } from '../src/shared/doc';
import { expand, instanceNode } from '../src/shared/components';
import { drawNode } from '../src/client/draw';
import { exportSVG } from '../src/client/export';

it('draws and exports deeply repeated components with one child index rather than per-node scans', () => {
    const doc: Doc = new Map();
    let main = { ...makeNode('frame', 0, 0), component: true };
    doc.set(main.id, main);
    const leaf = { ...makeNode('rect', 0, 0), parent: main.id }; doc.set(leaf.id, leaf);
    for (let level = 0; level < 6; level++) {
        const next = { ...makeNode('frame', 0, 0), component: true }; doc.set(next.id, next);
        for (let i = 0; i < 4; i++) { const n = instanceNode(main, 0, 0, next.id); doc.set(n.id, n); }
        main = next;
    }
    const start = performance.now(), expanded = expand(doc);
    expect(expanded.size).toBeGreaterThan(12000);
    const values = vi.spyOn(expanded, 'values'), tree = childIndex(expanded);
    const c = new Proxy({ globalAlpha: 1 }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => {} }) as CanvasRenderingContext2D;
    for (const root of tree.get(null) ?? []) drawNode(c, expanded, root, { zoom: 1, labels: false, tree });
    expect(values).toHaveBeenCalledTimes(1);
    expect(exportSVG(doc, [main.id])).toContain('<svg');
    expect(performance.now() - start).toBeLessThan(2000);
});
