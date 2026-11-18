import { describe, expect, it } from 'vitest';
import { fileId, readRecent, recordRecent, removeRecent } from '../src/client/recent-files';
function storage(initial: string | null = null) { let value = initial; return { getItem: () => value, setItem: (_: string, next: string) => { value = next; } }; }
describe('recent files', () => {
    it('survives a blocked localStorage getter', () => {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
        try {
            expect(readRecent()).toEqual([]);
            expect(() => recordRecent({ id: 'a' })).not.toThrow();
            expect(() => removeRecent('a')).not.toThrow();
            const s = storage(); recordRecent({ id: 'explicit' }, s);
            expect(readRecent(s)[0].id).toBe('explicit');
        } finally {
            if (original) Object.defineProperty(globalThis, 'localStorage', original);
            else Reflect.deleteProperty(globalThis, 'localStorage');
        }
    });
    it('starts empty and tolerates malformed or unavailable storage', () => {
        for (const value of [null, '{', '{}', '[null, {"id":"bad/id"}]']) expect(readRecent(storage(value))).toEqual([]);
        const unavailable = { getItem() { throw Error(); }, setItem() { throw Error(); } };
        expect(readRecent(unavailable)).toEqual([]); expect(() => recordRecent({ id: 'a' }, unavailable)).not.toThrow();
    });
    it('records, orders, updates previews without changing opened time, and removes', () => {
        const s = storage(); recordRecent({ id: 'a', opened: 1 }, s); recordRecent({ id: 'b', name: 'B', opened: 2 }, s);
        recordRecent({ id: 'a', thumbnail: 'data:image/png;base64,abc' }, s);
        expect(readRecent(s).map(f => [f.id, f.name, f.opened])).toEqual([['b', 'B', 2], ['a', 'Untitled', 1]]);
        recordRecent({ id: 'a', opened: 3 }, s); expect(readRecent(s)[0].thumbnail).toBe('data:image/png;base64,abc');
        removeRecent('a', s); expect(readRecent(s).map(f => f.id)).toEqual(['b']);
    });
    it('bounds the list and drops thumbnails when quota is exceeded', () => {
        const s = storage(); for (let i = 0; i < 35; i++) recordRecent({ id: String(i), opened: i }, s);
        expect(readRecent(s)).toHaveLength(30);
        const limited = { getItem: s.getItem, setItem(key: string, value: string) { if (value.includes('thumbnail')) throw Error('quota'); s.setItem(key, value); } };
        recordRecent({ id: 'x', thumbnail: 'data:image/png;base64,abc' }, limited); expect(readRecent(s).find(f => f.id === 'x')?.thumbnail).toBeUndefined();
    });
    it('accepts file IDs and links but not arbitrary paths', () => {
        expect(fileId(' abc-123 ')).toBe('abc-123'); expect(fileId('https://kerf.example/f/abc?x=1')).toBe('abc'); expect(fileId('/f/abc')).toBe('abc');
        expect(fileId('https://example.com/no')).toBeNull(); expect(fileId('')).toBeNull(); expect(fileId('javascript:alert(1)')).toBeNull();
    });
});
