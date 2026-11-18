import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Doc, type Node } from '../src/shared/doc';
import { exportJobs, exportPNG, validExportScale } from '../src/client/export';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
afterEach(() => vi.unstubAllGlobals());
it('keeps half-scale exports at least one pixel and rounds fractional dimensions outward', async () => {
    const node = { ...makeNode('rect', 0, 0), w: 1, h: 3 }, blob = new Blob(['png']);
    const context = { scale() {}, translate() {}, save() {}, restore() {}, beginPath() {}, roundRect() {}, fill() {}, globalAlpha: 1 };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: BlobCallback) => callback(blob) };
    vi.stubGlobal('document', { createElement: () => canvas });
    expect(await exportPNG(docOf(node), [node.id], .5)).toBe(blob);
    expect([canvas.width, canvas.height]).toEqual([1, 2]);
});
it('exports each selected root with independent bounds, excluding selected descendants', () => {
    const a = { ...makeNode('frame', 10, 20, 'A'), name: 'Home', w: 200, h: 100 }, b = { ...makeNode('frame', 500, 40, 'B'), name: 'About', w: 300, h: 400 };
    const child = { ...makeNode('rect', 0, 0), parent: a.id }, doc = docOf(a, b, child), ids = [a.id, b.id, child.id];
    const jobs = exportJobs(doc, ids, 'png', 1.5, 'each');
    expect(jobs.map(j => j.ids)).toEqual([[a.id], [b.id]]);
    expect(jobs.map(j => j.filename)).toEqual(['Home@1.5x.png', 'About@1.5x.png']);
    expect(jobs.map(j => j.bounds)).toEqual([{ x: 10, y: 20, w: 200, h: 100 }, { x: 500, y: 40, w: 300, h: 400 }]);
    const combined = exportJobs(doc, ids, 'svg');
    expect(combined).toHaveLength(1); expect(combined[0].filename).toBe('Export.svg'); expect(combined[0].bounds).toEqual({ x: 10, y: 20, w: 790, h: 420 });
});
it('deduplicates sanitized names case-insensitively for arbitrary selected roots', () => {
    const roots = ['A/B', 'a:b', 'A_B', '', 'Export'].map((name, i) => ({ ...makeNode('rect', i * 100, 0, String(i)), name }));
    expect(exportJobs(docOf(...roots), roots.map(n => n.id), 'svg', 1, 'each').map(j => j.filename)).toEqual(['A_B.svg', 'a_b (2).svg', 'A_B (3).svg', 'Export.svg', 'Export (2).svg']);
});
it('handles empty, missing, hidden and single-root selections', () => {
    const node = { ...makeNode('frame', 0, 0), name: 'Only' }, doc = docOf(node);
    expect(exportJobs(doc, [], 'png', .5, 'each')).toEqual([]);
    expect(exportJobs(doc, ['missing'], 'svg')).toEqual([]);
    expect(exportJobs(doc, [node.id], 'png', .5, 'each')[0].filename).toBe('Only@0.5x.png');
    node.hidden = true; expect(exportJobs(doc, [node.id], 'svg', 1, 'each')).toEqual([]);
});
it('accepts only finite PNG scales from 0.5 to 4 in half steps', async () => {
    for (const scale of [.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]) expect(validExportScale(scale)).toBe(true);
    const node = makeNode('frame', 0, 0), doc = docOf(node);
    for (const scale of [0, -.5, .25, .75, 4.5, NaN, Infinity]) {
        expect(validExportScale(scale)).toBe(false);
        expect(() => exportJobs(doc, [node.id], 'png', scale, 'each')).toThrow('PNG scale');
        await expect(exportPNG(doc, [node.id], scale)).rejects.toThrow('positive export scale');
    }
});
