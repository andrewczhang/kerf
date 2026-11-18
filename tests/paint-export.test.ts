import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Node, type Paint, type Doc } from '../src/shared/doc';
import { exportBounds, exportPNG, exportSVG } from '../src/client/export';
import { loadAsset } from '../src/client/assets';
vi.mock('../src/client/assets', () => ({ loadAsset: vi.fn(), assetImage: vi.fn() }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
const solid: Paint = { type: 'solid', color: '#123456', opacity: .5, visible: true };
const gradient: Paint = { type: 'linear', stops: [{ pos: 1, color: '#ffffff', opacity: .2 }, { pos: 0, color: '#000000', opacity: 1 }], from: { x: -.5, y: .5 }, to: { x: 1, y: .5 }, opacity: .75, visible: true };
const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
it('exports ordered solid and linear/radial paints with sorted stops, opacity and elliptical coordinates', () => {
    const n = { ...makeNode('ellipse', 20, 30), w: 200, h: 100, opacity: .5, fills: [solid, gradient, { ...gradient, type: 'radial' as const, from: { x: .5, y: .5 } }, { ...solid, color: '#ff0000', visible: false }] }, svg = exportSVG(docOf(n), [n.id]);
    expect(svg).toContain('fill="#123456" fill-opacity="0.5"'); expect(svg).toContain('opacity="0.5"'); expect(svg).toContain('<linearGradient'); expect(svg).toContain('x1="-0.5" y1="0.5"'); expect(svg).toContain('<radialGradient'); expect(svg).toContain('gradientUnits="objectBoundingBox" cx="0.5" cy="0.5" r="0.5"'); expect(svg.indexOf('offset="0"')).toBeLessThan(svg.indexOf('offset="1"')); expect(svg.indexOf('fill="#123456"')).toBeLessThan(svg.indexOf('fill="url(')); expect(svg).toContain('fill-opacity="0.75"'); expect(svg).not.toContain('#ff0000');
});
it('composites stacked fills and frame descendants under node opacity once', () => {
    const frame: Node = { ...makeNode('frame', 0, 0), id: 'frame', opacity: .5, fills: [{ ...solid, opacity: 1 }, { ...solid, opacity: 1 }] }, child: Node = { ...makeNode('rect', 0, 0), parent: frame.id, opacity: .4, fills: [solid] }, svg = exportSVG(docOf(frame, child), [frame.id]);
    expect(svg).toContain('<g id="frame" data-name="Frame" opacity="0.5">'); expect(svg.match(/fill-opacity="1"/g)).toHaveLength(2); expect(svg).toContain(`id="${child.id}" data-name="Rectangle" opacity="0.4"`); expect(svg).not.toContain('opacity="0.2"');
});
it('exports drop shadows, spread and layer blur filters with padded bounds', () => {
    const n: Node = { ...makeNode('rect', 0, 0), fills: [solid], effects: [{ type: 'drop-shadow', x: 5, y: 10, blur: 6, spread: 2, color: '#000000', opacity: .25, visible: true }, { type: 'layer-blur', radius: 3, visible: true }] }, doc = docOf(n), svg = exportSVG(doc, [n.id]);
    expect(svg).toContain('filterUnits="userSpaceOnUse"'); expect(svg).toContain('<feMorphology in="SourceAlpha" operator="dilate" radius="2"'); expect(svg).toContain('dx="5" dy="10"'); expect(svg).toContain('flood-opacity="0.25"'); expect(svg).toContain('in="shadowed" stdDeviation="3"'); expect(exportBounds(doc, [n])).toEqual({ x: -18, y: -13, w: 146, h: 146 }); expect(exportBounds(doc, [{ ...n, effects: [...n.effects!].reverse() }])).toEqual(exportBounds(doc, [n]));
});
it('preserves empty fills, frame child clips, stroke and SVG image fallback', () => {
    const frame: Node = { ...makeNode('frame', 0, 0), fills: [], stroke: '#abcdef', strokeWidth: 2 }, child: Node = { ...makeNode('rect', 10, 10), parent: frame.id, fill: '#654321', fills: [{ type: 'image', asset: 'a'.repeat(64), w: 20, h: 20, fit: 'fill', opacity: 1, visible: true }] }, svg = exportSVG(docOf(frame, child), [frame.id]);
    expect(svg).toContain('clip-path="url(#clip-0)"'); expect(svg).toContain('fill="none" stroke="#abcdef"'); expect(svg).toContain('fill="#654321"'); expect(svg).not.toContain(`fill="${frame.fill}"`);
});
it('waits for image loading and propagates errors instead of silently exporting missing images', async () => {
    const n: Node = { ...makeNode('rect', 0, 0), fills: [{ type: 'image', asset: 'a'.repeat(64), w: 20, h: 20, fit: 'fill', opacity: 1, visible: true }] }; vi.stubGlobal('location', { pathname: '/f/test-file' }); vi.mocked(loadAsset).mockRejectedValue(new Error('Asset unavailable'));
    await expect(exportPNG(docOf(n), [n.id], 2)).rejects.toThrow('Asset unavailable'); expect(loadAsset).toHaveBeenCalledWith('test-file', 'a'.repeat(64));
});
