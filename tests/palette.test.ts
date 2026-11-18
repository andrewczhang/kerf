import { describe, expect, it } from 'vitest';
import { commands, fuzzyMatch, registerCommand } from '../src/client/ui/palette';
describe('command matching', () => {
    it('matches case-insensitive subsequences and reports highlight positions', () => { expect(fuzzyMatch('Export selection PNG', 'eSp')).toEqual([0, 7, 17]); });
    it('matches empty and whitespace queries', () => { expect(fuzzyMatch('Rect tool', '  ')).toEqual([]); expect(fuzzyMatch('', '')).toEqual([]); });
    it('rejects missing and out-of-order characters', () => { expect(fuzzyMatch('Rect', 'xyz')).toBeNull(); expect(fuzzyMatch('Rect', 'tr')).toBeNull(); expect(fuzzyMatch('', 'a')).toBeNull(); });
    it('registers, replaces and removes commands safely', () => {
        const remove = registerCommand({ id: 'test', title: 'First', run() {} });
        const removeNext = registerCommand({ id: 'test', title: 'Next', run() {} });
        remove(); expect(commands.get('test')?.title).toBe('Next'); removeNext(); expect(commands.has('test')).toBe(false);
    });
});
