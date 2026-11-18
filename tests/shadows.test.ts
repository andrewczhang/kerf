import { afterEach, expect, it, vi } from 'vitest';
import { makeNode, type Node, type Paint } from '../src/shared/doc';
import { drawNode } from '../src/client/draw';
afterEach(() => vi.unstubAllGlobals());
it('skips empty/hidden/transparent shadow casters and strokes stroke-only casters', () => {
    vi.stubGlobal('Path2D', class { roundRect() {} });
    const shadow = { type: 'drop-shadow' as const, x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: 1, visible: true }, solid: Paint = { type: 'solid', color: '#000000', opacity: 1, visible: true };
    const render = (fills: Paint[], stroke: string | null = null) => { const n: Node = { ...makeNode('rect', 0, 0), fills, effects: [shadow], stroke }, c = { canvas: { width: 500, height: 500 }, globalAlpha: 1, save: vi.fn(), restore: vi.fn(), translate: vi.fn(), fill: vi.fn(), stroke: vi.fn() }; drawNode(c as unknown as CanvasRenderingContext2D, new Map([[n.id, n]]), n, { zoom: 2, labels: false, file: 'test' }); return c; };
    expect(render([]).fill).not.toHaveBeenCalled(); expect(render([{ ...solid, visible: false }]).fill).not.toHaveBeenCalled(); expect(render([{ ...solid, opacity: 0 }]).translate).not.toHaveBeenCalled();
    const stroke = render([], '#000000'); expect(stroke.fill).not.toHaveBeenCalled(); expect(stroke.stroke).toHaveBeenCalledTimes(2); expect(stroke.translate).toHaveBeenCalledTimes(1);
    expect(render([solid]).fill).toHaveBeenCalledTimes(2);
});
