import { expect, it, vi } from 'vitest';
import { documentColors } from '../src/client/ui/color-picker';
import { addColorPalette } from '../src/client/ui/styles';
import { Store } from '../src/client/store';
import type { Sync } from '../src/client/sync';
import { makeNode } from '../src/shared/doc';

it('collects and ranks deduplicated fills, strokes, gradient stops and local color styles', () => {
    const store = new Store();
    store.init([{ ...makeNode('rect', 0, 0), fill: '#AABBCC', stroke: '#112233' }, { ...makeNode('rect', 0, 0), fills: [{ type: 'linear', visible: true, opacity: 1, from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: [{ pos: 0, color: '#aabbcc', opacity: 1 }, { pos: 1, color: '#445566', opacity: 1 }] }] }]);
    expect(documentColors(store, { styles: [{ kind: 'color', color: '#112233' }] } as Sync)).toEqual(['#112233', '#aabbcc', '#445566']);
    expect(documentColors(new Store(), { styles: [] } as unknown as Sync)).toEqual([]);
});
it('creates named palette styles using the shared synchronization path, including empty palettes', () => {
    const send = vi.fn(), sync = { send } as unknown as Sync;
    addColorPalette(sync, { name: 'Test', colors: [] }); expect(send).not.toHaveBeenCalled();
    addColorPalette(sync, { name: 'Test', colors: ['#123456', '#abcdef'] });
    expect(send.mock.calls.map(([message]) => message)).toEqual([
        { type: 'style-upsert', style: { id: expect.any(String), kind: 'color', name: 'Test / 1', color: '#123456' } },
        { type: 'style-upsert', style: { id: expect.any(String), kind: 'color', name: 'Test / 2', color: '#abcdef' } },
    ]);
    expect(send.mock.calls[0][0].style.id).not.toBe(send.mock.calls[1][0].style.id);
});
