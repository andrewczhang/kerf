import { describe, expect, it, vi } from 'vitest';
import { commands, fuzzyMatch, installPalette, rankCommands, registerCommand } from '../src/client/ui/palette';
it.each(['ctrlKey', 'metaKey'])('reserves only the palette combo for %s', modifier => {
    let keydown: (e: KeyboardEvent) => void = () => {};
    const node = { value: '', children: [], replaceChildren() {}, removeAttribute() {}, focus() {} };
    const overlay = { hidden: true, querySelector: () => node };
    vi.stubGlobal('document', { createElement: () => overlay, body: { append() {} } });
    vi.stubGlobal('window', { addEventListener: (_: string, fn: typeof keydown) => { keydown = fn; } });
    try {
        const prepare = vi.fn(); installPalette({ focus() {} } as HTMLCanvasElement, prepare);
        for (const modifiers of [{ altKey: true }, { shiftKey: true }]) {
            const event = { key: 'k', [modifier]: true, ...modifiers, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
            keydown(event as unknown as KeyboardEvent);
            expect(event.preventDefault).not.toHaveBeenCalled(); expect(event.stopImmediatePropagation).not.toHaveBeenCalled();
        }
        expect(prepare).not.toHaveBeenCalled();
        const event = { key: 'k', [modifier]: true, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
        keydown(event as unknown as KeyboardEvent);
        expect(event.preventDefault).toHaveBeenCalledOnce(); expect(prepare).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
});
describe('command matching', () => {
    it('matches case-insensitive subsequences and reports highlight positions', () => { expect(fuzzyMatch('Export selection PNG', 'eSp')).toEqual([0, 7, 17]); });
    it('matches empty and whitespace queries', () => { expect(fuzzyMatch('Rect tool', '  ')).toEqual([]); expect(fuzzyMatch('', '')).toEqual([]); });
    it('rejects missing and out-of-order characters', () => { expect(fuzzyMatch('Rect', 'xyz')).toBeNull(); expect(fuzzyMatch('Rect', 'tr')).toBeNull(); expect(fuzzyMatch('', 'a')).toBeNull(); });
    const rank = (titles: string[], query: string) => rankCommands(titles.map(title => ({ id: title, title, run() {} })), query).map(c => c.title);
    it('ranks contiguous word prefixes above scattered subsequences', () => {
        expect(rank(['Select tool', 'Ellipse tool'], 'ell')).toEqual(['Ellipse tool', 'Select tool']);
        expect(rank(['Reset selection', 'Rectangle tool'], 'rect')).toEqual(['Rectangle tool', 'Reset selection']);
        expect(rank(['Some rectangle', 'Rectangle tool'], 'rect')[0]).toBe('Rectangle tool');
        expect(rank(['Collection', 'Ell tool'], 'ell')[0]).toBe('Ell tool');
    });
    it('ranks multiword queries by contiguity and gaps', () => {
        expect(rank(['Example painting', 'Export selection PNG', 'Export PNG'], 'exp png')).toEqual(['Export PNG', 'Export selection PNG', 'Example painting']);
        expect(fuzzyMatch('Export PNG', 'exp png')).toEqual([0, 1, 2, 7, 8, 9]);
    });
    it('breaks ties by title, handles empty results, and excludes disabled commands', () => {
        expect(rank(['Zoom out', 'Zoom in'], 'zoom')).toEqual(['Zoom in', 'Zoom out']);
        expect(rank(['Zoom out', 'Zoom in'], '')).toEqual(['Zoom in', 'Zoom out']);
        expect(rank(['Ellipse tool'], 'xyz')).toEqual([]);
        expect(rankCommands([{ id: 'disabled', title: 'Ellipse', run() {}, enabled: () => false }], 'ell')).toEqual([]);
    });
    it('registers, replaces and removes commands safely', () => {
        const remove = registerCommand({ id: 'test', title: 'First', run() {} });
        const removeNext = registerCommand({ id: 'test', title: 'Next', run() {} });
        remove(); expect(commands.get('test')?.title).toBe('Next'); removeNext(); expect(commands.has('test')).toBe(false);
    });
});
