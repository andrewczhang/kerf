export interface RecentFile { id: string; name: string; opened: number; thumbnail?: string }
export const RECENT_KEY = 'kerf:recent-files';
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function recentStorage(storage?: StorageLike): StorageLike | undefined {
    try { return storage ?? localStorage; } catch { return undefined; }
}
export function readRecent(storage?: StorageLike): RecentFile[] {
    try {
        storage = recentStorage(storage);
        if (!storage) return [];
        const value: unknown = JSON.parse(storage.getItem(RECENT_KEY) ?? '[]');
        if (!Array.isArray(value)) return [];
        const seen = new Set<string>();
        return value.filter((f): f is RecentFile => !!f && typeof f.id === 'string' && /^[\w-]+$/.test(f.id) && typeof f.name === 'string' && typeof f.opened === 'number' && Number.isFinite(f.opened) && (f.thumbnail === undefined || typeof f.thumbnail === 'string' && f.thumbnail.startsWith('data:image/'))).sort((a, b) => b.opened - a.opened).filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true; }).slice(0, 30);
    } catch { return []; }
}
function write(files: RecentFile[], storage: StorageLike) {
    try { storage.setItem(RECENT_KEY, JSON.stringify(files)); } catch {
        try { storage.setItem(RECENT_KEY, JSON.stringify(files.map(({ thumbnail: _, ...file }) => file))); } catch { /* Storage may be disabled. */ }
    }
}
export function recordRecent(file: Pick<RecentFile, 'id'> & Partial<RecentFile>, storage?: StorageLike) {
    storage = recentStorage(storage);
    if (!storage) return;
    const files = readRecent(storage), previous = files.find(f => f.id === file.id);
    const next = { name: 'Untitled', opened: Date.now(), ...previous, ...file };
    write([next, ...files.filter(f => f.id !== file.id)].sort((a, b) => b.opened - a.opened).slice(0, 30), storage);
}
export function removeRecent(id: string, storage?: StorageLike) { storage = recentStorage(storage); if (storage) write(readRecent(storage).filter(f => f.id !== id), storage); }
export function fileId(value: string): string | null {
    const trimmed = value.trim();
    if (/^[\w-]+$/.test(trimmed)) return trimmed;
    try { return new URL(trimmed, 'https://kerf.local').pathname.match(/^\/f\/([\w-]+)\/?$/)?.[1] ?? null; } catch { return null; }
}
export function newFile() { location.assign('/f/' + crypto.randomUUID().slice(0, 12)); }
