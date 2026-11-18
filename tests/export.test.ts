import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Doc, type Node } from '../src/shared/doc';
import { exportBounds, exportFilename, exportPNG, exportRoots, exportSVG } from '../src/client/export';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
afterEach(() => vi.unstubAllGlobals());

it('drops selected descendants and missing ids, preserving tree paint order', () => {
    const a = makeNode('frame', 0, 0, 'A'), b = makeNode('rect', 0, 0, 'B');
    const child = { ...makeNode('frame', 10, 10), parent: a.id };
    const grandchild = { ...makeNode('ellipse', 5, 5), parent: child.id };
    const doc = docOf(b, grandchild, child, a);
    expect(exportRoots(doc, [b.id, grandchild.id, a.id, child.id, 'missing'])).toEqual([a, b]);
    expect(exportRoots(doc, [b.id, grandchild.id])).toEqual([grandchild, b]);
});

it('includes centered stroke overflow and rounds bounds outward in world coordinates', () => {
    const frame = makeNode('frame', 100, -20);
    const child = { ...makeNode('rect', .25, .75), parent: frame.id, w: 10, h: 20, stroke: '#000000', strokeWidth: 3 };
    const other = { ...makeNode('ellipse', 120.5, -10), w: 2, h: 3, strokeWidth: 50 };
    expect(exportBounds(docOf(frame, child, other), [child, other])).toEqual({ x: 98, y: -21, w: 25, h: 24 });
});

it('exports rounded frames, world-space ellipses, clips and cumulative primitive alpha', () => {
    const frame = { ...makeNode('frame', 10, 20), id: 'frame', radius: 12, opacity: .5 };
    const ellipse = { ...makeNode('ellipse', 5, 6), id: 'ellipse', parent: frame.id, opacity: .5, stroke: '#123456', strokeWidth: 3 };
    const svg = exportSVG(docOf(ellipse, frame), [frame.id, ellipse.id]);
    expect(svg).toContain('viewBox="10 20 100 100" width="100" height="100"');
    expect(svg).toContain('<clipPath id="clip-0"><rect x="10" y="20" width="100" height="100" rx="12" ry="12"/>');
    expect(svg).toContain('<g clip-path="url(#clip-0)">');
    expect(svg).toContain('cx="65" cy="76" rx="50" ry="50"');
    expect(svg).toContain('fill-opacity="0.25"');
    expect(svg).toContain('stroke-width="3" stroke-opacity="0.25"');
    expect(svg).not.toMatch(/<g[^>]*\sopacity=/);
    expect(svg.match(/id="ellipse"/g)).toHaveLength(1);
});

it('escapes names and ids, clamps radii, and omits default opacity and zero radius', () => {
    const node = { ...makeNode('rect', 0, 0), id: '<&"', name: '<&"', radius: 100, w: 10, h: 20 };
    const svg = exportSVG(docOf(node), [node.id]);
    expect(svg).toContain('id="&lt;&amp;&quot;" data-name="&lt;&amp;&quot;"');
    expect(svg).toContain('rx="5" ry="5"');
    expect(svg).not.toContain('opacity=');
    node.radius = 0;
    expect(exportSVG(docOf(node), [node.id])).not.toContain('rx=');
});

it('exports wrapped text as aligned, escaped SVG text runs', () => {
    const measureText = (line: string) => ({ width: line.length * 10, fontBoundingBoxAscent: 18, fontBoundingBoxDescent: 6 });
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ measureText }) }) });
    const node = { ...makeNode('text', 10, 20), text: '<& long', fontSize: 20, textWidth: 'fixed' as const, textAlign: 'right' as const, w: 40 };
    const svg = exportSVG(docOf(node), [node.id]);
    expect(svg).toContain('viewBox="10 20 40 48"');
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('<tspan x="50" y="38">&lt;&amp;</tspan><tspan x="50" y="62">long</tspan>');
    expect(svg).not.toContain('<rect');
});

it('handles empty and stale selections deterministically', async () => {
    const doc: Doc = new Map();
    expect(exportRoots(doc, ['missing'])).toEqual([]);
    expect(exportBounds(doc, [])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(exportSVG(doc, [])).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0" width="0" height="0"></svg>');
    await expect(exportPNG(doc, [], 1)).rejects.toThrow('Select objects');
});

it('uses sanitized root names and scale suffixes for filenames', () => {
    const node = { ...makeNode('rect', 0, 0), name: 'a/b:<&". ' }, other = makeNode('rect', 0, 0);
    const doc = docOf(node, other);
    expect(exportFilename(doc, [node.id], 'png', 2)).toBe('a_b__&_@2x.png');
    expect(exportFilename(doc, [node.id], 'svg')).toBe('a_b__&_.svg');
    expect(exportFilename(doc, [node.id, other.id], 'png')).toBe('Export.png');
});

it('renders transparent scaled PNGs without frame labels and reports encoding failures', async () => {
    const node = { ...makeNode('frame', 10, 20), w: 30, h: 40 };
    const doc = docOf(node), blob = new Blob(['png'], { type: 'image/png' });
    const c = { scale: vi.fn(), translate: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), clip: vi.fn(), fillText: vi.fn(), globalAlpha: 1 };
    const canvas = { width: 0, height: 0, getContext: vi.fn(() => c), toBlob: vi.fn((callback: BlobCallback) => callback(blob)) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    expect(await exportPNG(doc, [node.id], 2)).toBe(blob);
    expect([canvas.width, canvas.height]).toEqual([60, 80]);
    expect(c.scale).toHaveBeenCalledWith(2, 2);
    expect(c.translate).toHaveBeenCalledWith(-10, -20);
    expect(c.roundRect).toHaveBeenCalledWith(10, 20, 30, 40, 0);
    expect(c.fillText).not.toHaveBeenCalled();
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
    canvas.toBlob.mockImplementation(callback => callback(null));
    await expect(exportPNG(doc, [node.id], 1)).rejects.toThrow('PNG export failed');
    await expect(exportPNG(doc, [node.id], 0)).rejects.toThrow('positive export scale');
});
