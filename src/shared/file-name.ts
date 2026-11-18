export function sanitizeFileName(name: string): string {
    return Array.from(name.trim().replace(/\s+/g, ' ')).slice(0, 80).join('');
}
