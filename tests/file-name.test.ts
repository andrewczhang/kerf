import { describe, expect, it } from 'vitest';
import { sanitizeFileName } from '../src/shared/file-name';
describe('file name sanitization', () => {
    it('trims and collapses whitespace', () => { expect(sanitizeFileName('  Layout\n\tstudy   01 ')).toBe('Layout study 01'); });
    it('keeps unnamed files empty', () => { expect(sanitizeFileName(' \n\t ')).toBe(''); expect(sanitizeFileName('')).toBe(''); });
    it('limits names to 80 Unicode characters without splitting surrogate pairs', () => {
        expect(sanitizeFileName('x'.repeat(100))).toBe('x'.repeat(80));
        expect(sanitizeFileName('😀'.repeat(81))).toBe('😀'.repeat(80));
    });
});
