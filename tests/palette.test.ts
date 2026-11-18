import { describe, expect, it } from 'vitest';
import { commands, fuzzyMatch, rankCommands, registerCommand } from '../src/client/ui/palette';
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
