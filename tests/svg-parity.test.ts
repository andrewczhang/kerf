import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, between, type Doc, type Node, type Paint, type Effect } from '../src/shared/doc';
import { corner } from '../src/shared/path';
import { exportSVG, exportSVGWithAssets } from '../src/client/export';
vi.mock('../src/client/text-layout', () => ({ fontFamilies: { sans: 'sans-serif' }, measureTextNode: () => ({ lines: ['Paint'], leading: 30, baseline: 24, offset: 0, w: 100, h: 30 }), textPaintBounds: () => ({ x: 0, y: 0, w: 100, h: 30 }) }));
afterEach(() => vi.unstubAllGlobals());
const hash = 'a'.repeat(64), uri = 'data:image/png;base64,AQID', images = new Map([[hash, uri]]), image: Paint = { type: 'image', asset: hash, w: 40, h: 20, fit: 'fill', opacity: .6, visible: true }, solid: Paint = { type: 'solid', color: '#123456', opacity: 1, visible: true }, inner: Effect = { type: 'inner-shadow', x: 4, y: -2, blur: 8, spread: 3, color: '#abcdef', opacity: .4, visible: true }, backdrop: Effect = { type: 'background-blur', radius: 6, visible: true };
const docOf = (...nodes: Node[]): Doc => new Map(nodes.map(n => [n.id, n]));
it('keeps twenty blurred siblings linear in serialized size and free of replay recursion', () => {
    const scene = (count: number) => { let index: string | null = null; const nodes = Array.from({ length: count }, (_, i) => { index = between(index); return { ...makeNode('rect', i * 5, 0), index, fills: [solid], effects: [backdrop] }; }); return exportSVG(docOf(...nodes), nodes.map(n => n.id)); };
    const ten = scene(10), twenty = scene(20); expect(twenty.length).toBeLessThan(ten.length * 2.3); expect([...twenty.matchAll(/<use /g)].length).toBeLessThan(100);
    const definitions = twenty.slice(0, twenty.indexOf('</defs>')); expect(definitions).not.toContain('<feGaussianBlur'); expect(definitions).not.toContain('clip-path=');
});
it.each([false, true])('clips earlier child replay to every ancestor frame (painted=%s)', painted => {
    const outer = { ...makeNode('frame', 0, 0), ...(painted ? { fills: [] } : {}) }, frame = { ...makeNode('frame', 20, 20), parent: outer.id, w: 50, h: 50 }, outside = { ...makeNode('rect', 40, 0), parent: frame.id, name: 'Outside', w: 40 }, glass = { ...makeNode('rect', 10, 10), parent: frame.id, index: between(outside.index), effects: [backdrop] }, svg = exportSVG(docOf(outer, frame, outside, glass), [outer.id]);
    const original = /<g id="([^"]+)"><rect[^>]*data-name="Outside"/.exec(svg)![1];
    const replay = new RegExp(`<g clip-path="url\\(#([^\"]+)\\)"><g clip-path="url\\(#([^\"]+)\\)"><use href="#${original}"/></g></g>`).exec(svg);
    expect(replay).not.toBeNull(); expect(replay![1]).not.toBe(replay![2]);
});
it.each(['fill', 'fit', 'tile'] as const)('embeds %s images with world-space placement, opacity and paint order', fit => {
    const n = { ...makeNode('rect', 20, 30), radius: 12, fills: [solid, { ...image, fit }, { ...solid, color: '#ff0000', opacity: .2 }] }, svg = exportSVG(docOf(n), [n.id], images);
    expect(svg).toContain(`href="${uri}"`); expect(svg).not.toContain('/f/'); expect(svg.indexOf('fill="#123456"')).toBeLessThan(svg.indexOf(fit === 'tile' ? 'fill="url(' : '<image x=')); expect(svg.lastIndexOf('fill="#ff0000"')).toBeGreaterThan(svg.indexOf(fit === 'tile' ? 'fill="url(' : '<image x='));
    if (fit === 'tile') { expect(svg).toContain('patternUnits="userSpaceOnUse" x="20" y="30" width="40" height="20"'); expect(svg).toContain('fill-opacity="0.6"'); }
    else { expect(svg).toContain(fit === 'fill' ? '<image x="-30" y="30" width="200" height="100"' : '<image x="20" y="55" width="100" height="50"'); expect(svg).toContain('opacity="0.6" clip-path='); expect(svg).toContain('rx="12" ry="12"'); }
});
it.each(['ellipse', 'path', 'text'] as const)('clips image paints to %s geometry', type => {
    const n = { ...makeNode(type, 0, 0), closed: true, points: [corner(0, 0), corner(1, 0), corner(0, 1)], fills: [image] }, svg = exportSVG(docOf(n), [n.id], images);
    expect(svg).toContain('<clipPath'); expect(svg).toContain(`<${type === 'path' ? 'path d=' : type === 'text' ? 'text xml:space=' : 'ellipse cx='}`); expect(svg).toContain(`href="${uri}"`);
});
it('loads each visible grouped asset once and emits only embedded bytes', async () => {
    const group = makeNode('group', 0, 0), a = { ...makeNode('rect', 0, 0), parent: group.id, fills: [image, image] }, hidden = { ...makeNode('rect', 0, 0), hidden: true, fills: [{ ...image, asset: 'b'.repeat(64) }] }, fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('location', { pathname: '/f/image-file' });
    const svg = await exportSVGWithAssets(docOf(group, a, hidden), [group.id, hidden.id]); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledWith(`/f/image-file/assets/${hash}`); expect(svg.match(/href="data:image\/png;base64,AQID"/g)).toHaveLength(2); expect(svg).not.toContain('/assets/');
});
it('handles an empty image export without fetching and reports missing/unsupported assets', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 404 })); vi.stubGlobal('fetch', fetch); await exportSVGWithAssets(new Map(), []); expect(fetch).not.toHaveBeenCalled();
    const n = { ...makeNode('rect', 0, 0), fills: [image] }; await expect(exportSVGWithAssets(docOf(n), [n.id])).rejects.toThrow('Asset unavailable'); expect(() => exportSVG(docOf(n), [n.id])).toThrow('SVG image asset unavailable');
    fetch.mockResolvedValue(new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })); await expect(exportSVGWithAssets(docOf(n), [n.id])).rejects.toThrow('Unsupported image asset');
});
it.each([3, -3])('exports clipped inner shadow with signed spread %s independent of fill alpha', spread => {
    const n = { ...makeNode('ellipse', 0, 0), fills: [], effects: [{ ...inner, spread }] }, svg = exportSVG(docOf(n), [n.id]);
    expect(svg).toContain(`operator="${spread > 0 ? 'erode' : 'dilate'}" radius="3"`); expect(svg).toContain('tableValues="1 0"'); expect(svg).toContain('stdDeviation="4"'); expect(svg).toContain('dx="4" dy="-2"'); expect(svg).toContain('flood-color="#abcdef" flood-opacity="0.4"'); expect(svg).toContain('<feComposite in2="SourceAlpha" operator="in"/>'); expect(svg).toContain('clip-path=');
});
it('keeps drop shadows below backdrop replay and interior shadows, then applies layer blur last', () => {
    const below = makeNode('rect', 0, 0), n = { ...makeNode('rect', 0, 0), index: between(below.index), fills: [solid], effects: [{ ...inner, type: 'drop-shadow' as const }, backdrop, inner, { type: 'layer-blur' as const, radius: 2, visible: true }] }, svg = exportSVG(docOf(below, n), [below.id, n.id]);
    expect(svg).toContain('stdDeviation="2"'); expect(svg).toContain('<use href='); const replay = /<g id="([^"]+)" filter="url\(#[^"]+\)"><rect[^>]+fill="#000000"/.exec(svg)![1]; expect(svg).not.toContain(`<use href="#${replay}"`); expect(svg.indexOf(`id="${replay}"`)).toBeLessThan(svg.indexOf('<g clip-path='));
    const empty = { ...n, fills: [], effects: [n.effects[0], inner] }; expect(exportSVG(docOf(empty), [empty.id])).not.toContain('result="shadow0"');
});
it('replays only earlier visible content for background blur without duplicate IDs', () => {
    const a = makeNode('rect', 0, 0), group = { ...makeNode('group', 0, 0), index: between(a.index) }, hidden = { ...makeNode('rect', 0, 0), parent: group.id, name: 'Hidden backdrop', hidden: true }, b = { ...makeNode('ellipse', 20, 20), index: between(group.index), fills: [], effects: [backdrop, backdrop] }, later = { ...makeNode('rect', 0, 0), index: between(b.index) }, svg = exportSVG(docOf(a, group, hidden, b, later), [a.id, group.id, b.id, later.id]);
    expect(svg).toContain('stdDeviation="6"'); expect(svg).toContain('<use href="#paint-0"/>'); expect(svg).not.toContain('Hidden backdrop'); const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); expect(new Set(ids).size).toBe(ids.length);
    for (const [, id] of svg.matchAll(/<use href="#([^"]+)"/g)) { expect(ids).toContain(id); expect(svg.indexOf(`id="${id}"`)).toBeLessThan(svg.indexOf(`<use href="#${id}"`)); }
    expect(svg.indexOf('stdDeviation="6"')).toBeLessThan(svg.indexOf(`id="${later.id}"`));
});
it('keeps frame backdrops acyclic and skips interior effects on open paths and hidden nodes', () => {
    const frame = { ...makeNode('frame', 0, 0), fills: [solid] }, n = { ...makeNode('rect', 10, 10), parent: frame.id, fills: [], effects: [backdrop, inner] }, svg = exportSVG(docOf(frame, n), [frame.id]); expect(svg).toContain('<use href='); expect(svg).toContain('tableValues="1 0"');
    const open = { ...makeNode('path', 0, 0), fills: [image], effects: [inner, backdrop] }; const openSvg = exportSVG(docOf(open), [open.id]); expect(openSvg).not.toContain('<feGaussianBlur'); expect(openSvg).not.toContain('<image');
    expect(exportSVG(docOf({ ...n, hidden: true }), [n.id])).not.toContain('<filter'); expect(exportSVG(docOf({ ...n, parent: null, effects: [backdrop] }), [n.id])).not.toContain('<feGaussianBlur');
});
