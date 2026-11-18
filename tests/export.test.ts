import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Doc, type Node } from '../src/shared/doc';
import { corner } from '../src/shared/path';
import { exportBounds, exportFilename, exportPNG, exportRoots, exportSVG } from '../src/client/export';

const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
afterEach(() => vi.unstubAllGlobals());

it('exports group children without a group primitive or hidden subtrees', () => {
    const group = { ...makeNode('group', 10, 20), id: 'group' }, a = { ...makeNode('rect', 5, 6), id: 'visible', parent: group.id }, b = { ...makeNode('frame', 0, 0), id: 'hidden', parent: group.id, hidden: true }, c = { ...makeNode('ellipse', 0, 0), id: 'descendant', parent: b.id };
    const doc = docOf(group, a, b, c), svg = exportSVG(doc, [group.id]);
    expect(svg).toContain('id="visible"');
    expect(svg).toContain('x="15" y="26"');
    for (const id of ['group', 'hidden', 'descendant']) expect(svg).not.toContain('id="' + id + '"');
    expect(exportRoots(doc, [c.id])).toEqual([]);
});

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

it('includes the spread-expanded arrowhead shadow in PNG export bounds', () => {
    const node: Node = {
        ...makeNode('path', 0, 0), h: 1, points: [corner(0, 0), corner(1, 0)], strokeWidth: 8, strokeEnd: 'circle',
        effects: [{ type: 'drop-shadow', x: 0, y: 5, blur: 0, spread: 12, color: '#000000', opacity: 1, visible: true }]
    };
    expect(exportBounds(docOf(node), [node])).toEqual({ x: -16, y: -40, w: 132, h: 90 });
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
    const narrow = { ...node, w: 1, text: 'W' };
    expect(exportBounds(docOf(narrow), [narrow])).toEqual({ x: 1, y: 20, w: 10, h: 24 });
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

it('exports closed paths as filled cubic path data and open paths unfilled', () => {
    const shape = { ...makeNode('path', 10, 20), id: 'shape', w: 100, h: 50, closed: true, points: [{ x: 0, y: 0, ix: 0, iy: 0, ox: .5, oy: 0 }, { x: 1, y: 1, ix: 1, iy: .5, ox: 1, oy: 1 }] };
    const svg = exportSVG(docOf(shape), [shape.id]);
    expect(svg).toContain('<path id="shape" data-name="Path" d="M10 20C60 20 110 45 110 70C110 70 10 20 10 20Z"');
    expect(svg).toContain('fill="#ff4f00"');
    const line = { ...shape, closed: false };
    expect(exportSVG(docOf(line), [line.id])).toContain('fill="none"');
});

it('clips inside strokes and masks outside strokes without cropping aligned ink', () => {
    const rect: Node = { ...makeNode('rect', 10, 20), stroke: '#123456', strokeWidth: 6, strokeAlign: 'inside', strokeDash: 7, strokeGap: 3, strokeJoin: 'miter', strokeMiterLimit: 2, strokeCap: 'square' };
    const inside = exportSVG(docOf(rect), [rect.id]);
    expect(inside).toContain('viewBox="10 20 100 100"');
    expect(inside).toContain('<clipPath id="clip-0">');
    expect(inside).toContain('fill="none" stroke="#123456" stroke-width="12" stroke-linecap="square" stroke-linejoin="miter" stroke-miterlimit="2" stroke-dasharray="7 3" clip-path="url(#clip-0)"');
    const group = makeNode('group', 10, 20);
    const outside: Node = { ...rect, x: 0, y: 0, parent: group.id, strokeAlign: 'outside', strokeGap: 0 };
    const svg = exportSVG(docOf(group, outside), [group.id]);
    expect(svg).toContain('viewBox="4 14 112 112"');
    expect(svg).toContain('<mask id="clip-0" maskUnits="userSpaceOnUse"');
    expect(svg).toContain('fill="black" fill-rule="evenodd"');
    expect(svg).toContain('mask="url(#clip-0)"');
    expect(svg).not.toContain('stroke-dasharray');
});

it('renders a solid stroke in SVG and PNG when only the gap is positive', async () => {
    const node: Node = { ...makeNode('rect', 0, 0), stroke: '#000000', strokeGap: 8 };
    const doc = docOf(node);
    expect(exportSVG(doc, [node.id])).not.toContain('stroke-dasharray');
    const c = { scale: vi.fn(), translate: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), globalAlpha: 1 };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => c, toBlob: (callback: BlobCallback) => callback(new Blob()) }) });
    await exportPNG(doc, [node.id], 1);
    expect(c.stroke).toHaveBeenCalledOnce();
    expect(c.setLineDash).not.toHaveBeenCalled();
});

it('draws open path arrowheads along endpoint tangents and includes their ink in export bounds', () => {
    const line: Node = { ...makeNode('path', 0, 0), h: 1, strokeAlign: 'outside', strokeStart: 'bar', strokeEnd: 'triangle', strokeWidth: 5, strokeCap: 'butt', strokeJoin: 'bevel', points: [{ ...corner(0, 0), ox: .5 }, { ...corner(1, 0), ix: 1, iy: -10 }] };
    const svg = exportSVG(docOf(line), [line.id]);
    expect(svg).toContain('viewBox="-3 -18 111 29"');
    expect(svg).toContain('stroke-width="5" stroke-linecap="butt" stroke-linejoin="bevel"');
    expect(svg).toContain('<polyline points="0,8 0,-8"');
    expect(svg).toContain('<polygon points="108,-17.5 100,0 92,-17.5"');
    expect(svg).not.toContain('<mask');
    const closed = { ...line, closed: true };
    expect(exportSVG(docOf(closed), [line.id])).not.toMatch(/<(polyline|polygon)/);
});

it('passes aligned stroke, dash, cap, join and miter settings through the PNG drawing path', async () => {
    const node: Node = { ...makeNode('rect', 10, 20), stroke: '#123456', strokeWidth: 4, strokeAlign: 'outside', strokeDash: 8, strokeGap: 5, strokeCap: 'round', strokeJoin: 'miter', strokeMiterLimit: 2 };
    const c = { scale: vi.fn(), translate: vi.fn(), save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), rect: vi.fn(), fill: vi.fn(), clip: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), globalAlpha: 1 };
    const blob = new Blob(), canvas = { width: 0, height: 0, getContext: () => c, toBlob: (callback: BlobCallback) => callback(blob) };
    vi.stubGlobal('document', { createElement: () => canvas });
    await expect(exportPNG(docOf(node), [node.id], 2)).resolves.toBe(blob);
    expect([canvas.width, canvas.height]).toEqual([216, 216]);
    expect(c.rect).toHaveBeenCalledWith(5, 15, 110, 110);
    expect(c.clip).toHaveBeenCalledWith('evenodd');
    expect(c.setLineDash).toHaveBeenCalledWith([8, 5]);
    expect(c).toMatchObject({ lineWidth: 8, lineCap: 'round', lineJoin: 'miter', miterLimit: 2 });
    expect(c.stroke).toHaveBeenCalledOnce();
});

it('keeps advanced strokes when the node has an explicit fill stack', async () => {
    const node: Node = { ...makeNode('rect', 10, 20), fills: [], stroke: '#123456', strokeWidth: 4, strokeAlign: 'inside', strokeDash: 8, strokeGap: 5 };
    const c = { scale: vi.fn(), translate: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(), setLineDash: vi.fn(), globalAlpha: 1 };
    class Shape { roundRect = vi.fn(); }
    vi.stubGlobal('Path2D', Shape);
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => c, toBlob: (callback: BlobCallback) => callback(new Blob()) }) });
    const doc = docOf(node);
    await exportPNG(doc, [node.id], 1);
    expect(c.fill).not.toHaveBeenCalled();
    expect(c.clip).toHaveBeenCalledWith(expect.any(Shape), 'evenodd');
    expect(c.setLineDash).toHaveBeenCalledWith([8, 5]);
    expect(c.stroke).toHaveBeenCalledWith(expect.any(Shape));
    const svg = exportSVG(doc, [node.id]);
    expect(svg).toContain('stroke-width="8"');
    expect(svg).toContain('stroke-dasharray="8 5" clip-path="url(#paint-0)"');
});
