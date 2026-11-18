import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Node, type Paint } from '../src/shared/doc';
import { drawNode } from '../src/client/draw';
import { corner } from '../src/shared/path';
afterEach(() => vi.unstubAllGlobals());
it('skips empty/hidden/transparent shadow casters and strokes stroke-only casters', () => {
    vi.stubGlobal('Path2D', class { roundRect() {} });
    const shadow = { type: 'drop-shadow' as const, x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 1, visible: true }, solid: Paint = { type: 'solid', color: '#000000', opacity: 1, visible: true };
    const render = (fills: Paint[], stroke: string | null = null) => { const n: Node = { ...makeNode('rect', 0, 0), fills, effects: [shadow], stroke }, c = { canvas: { width: 500, height: 500 }, globalAlpha: 1, save: vi.fn(), restore: vi.fn(), translate: vi.fn(), fill: vi.fn(), stroke: vi.fn() }; drawNode(c as unknown as CanvasRenderingContext2D, new Map([[n.id, n]]), n, { zoom: 2, labels: false, file: 'test' }); return c; };
    expect(render([]).fill).not.toHaveBeenCalled(); expect(render([{ ...solid, visible: false }]).fill).not.toHaveBeenCalled(); expect(render([{ ...solid, opacity: 0 }]).translate).not.toHaveBeenCalled();
    const stroke = render([], '#000000'); expect(stroke.fill).not.toHaveBeenCalled(); expect(stroke.stroke).toHaveBeenCalledTimes(2); expect(stroke.translate).toHaveBeenCalledTimes(1);
    expect(render([solid]).fill).toHaveBeenCalledTimes(2);
});
it.each([-1, -2])('does not cast a collapsed stroke-only shadow with spread %s', spread => {
    vi.stubGlobal('Path2D', class { roundRect() {} });
    const n: Node = { ...makeNode('rect', 0, 0), fills: [], stroke: '#000000', strokeWidth: 2, effects: [{ type: 'drop-shadow', x: 0, y: 4, blur: 12, spread, color: '#000000', opacity: 1, visible: true }] };
    let width = 1;
    const c = { canvas: { width: 500, height: 500 }, globalAlpha: 1, get lineWidth() { return width; }, set lineWidth(value: number) { if (value > 0) width = value; }, save: vi.fn(), restore: vi.fn(), translate: vi.fn(), fill: vi.fn(), stroke: vi.fn() };
    drawNode(c as unknown as CanvasRenderingContext2D, new Map([[n.id, n]]), n, { zoom: 1, labels: false, file: 'test' });
    expect(c.stroke).toHaveBeenCalledTimes(1);
    expect(c.fill).not.toHaveBeenCalled();
});

it.each(['inside', 'outside', 'arrow'] as const)('casts a stroke-only %s shadow from the painted silhouette', mode => {
    const n: Node = {
        ...makeNode(mode === 'arrow' ? 'path' : 'rect', 0, 0),
        ...(mode === 'arrow' ? { points: [corner(0, 0), corner(1, 0)], strokeEnd: 'circle' } : { strokeAlign: mode }),
        fills: [], stroke: '#000000', strokeWidth: 8, strokeDash: 6, strokeGap: 4,
        effects: [{ type: 'drop-shadow', x: 10, y: 14, blur: 2, spread: 0, color: '#000000', opacity: 1, visible: true }]
    };
    vi.stubGlobal('Path2D', class { moveTo() {} bezierCurveTo() {} roundRect() {} rect() {} addPath() {} });
    const context = () => ({
        save: vi.fn(), restore: vi.fn(), translate: vi.fn(), setTransform: vi.fn(), clip: vi.fn(),
        setLineDash: vi.fn(), stroke: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), fill: vi.fn(), drawImage: vi.fn(), globalAlpha: 1
    });
    const caster = context(), buffer = { width: 0, height: 0, getContext: () => caster };
    const target = { ...context(), canvas: { width: 500, height: 500 }, getTransform: () => ({ e: 0, f: 0 }) };
    vi.stubGlobal('document', { createElement: () => buffer });
    drawNode(target as unknown as CanvasRenderingContext2D, new Map([[n.id, n]]), n, { zoom: 2, labels: false, file: 'test' });
    expect(caster.stroke).toHaveBeenCalledOnce();
    expect(caster.setLineDash).toHaveBeenCalledWith([6, 4]);
    expect(target.drawImage.mock.calls[0]?.[0]).toBe(buffer);
    if (mode === 'arrow') {
        expect(caster.arc).toHaveBeenCalledOnce();
        expect(caster.fill).toHaveBeenCalledOnce();
    }
    else {
        expect(caster.clip).toHaveBeenCalledWith(expect.any(Path2D), 'evenodd');
        expect(caster).toMatchObject({ lineWidth: 16 });
    }
});

it('clips stroke shadow rasters to the translated viewport, caps their size and skips offscreen shadows', () => {
    const n: Node = {
        ...makeNode('rect', 0, 0), w: 1000, h: 1000, fills: [], stroke: '#000000', strokeAlign: 'inside',
        effects: [{ type: 'drop-shadow', x: 10, y: 20, blur: 0, spread: 0, color: '#000000', opacity: 1, visible: true }]
    };
    vi.stubGlobal('Path2D', class { roundRect() {} });
    const c = { save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), clip: vi.fn(), stroke: vi.fn(), globalAlpha: 1 };
    const buffer = { width: 0, height: 0, getContext: () => c };
    const createElement = vi.fn(() => buffer);
    vi.stubGlobal('document', { createElement });
    const transform = { e: -5000, f: -4000 };
    const target = { ...c, canvas: { width: 5000, height: 1000 }, getTransform: () => transform, drawImage: vi.fn() };
    const draw = () => drawNode(target as unknown as CanvasRenderingContext2D, new Map([[n.id, n]]), n, { zoom: 16, labels: false });
    draw();
    expect(createElement).toHaveBeenCalledOnce();
    expect(buffer.width).toBe(4096);
    expect(buffer.height).toBeLessThanOrEqual(1004);
    expect(target.drawImage).toHaveBeenCalledWith(buffer, -5006, -322, 5004, 1004);
    expect(target).toMatchObject({ shadowOffsetX: 5004, shadowOffsetY: 320 });
    transform.e = -25000;
    draw();
    expect(createElement).toHaveBeenCalledOnce();
    expect(target.drawImage).toHaveBeenCalledOnce();
});
