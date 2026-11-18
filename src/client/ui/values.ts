export function formatNumber(value: number): string {
    return Number.isFinite(value) ? String(Number(value.toFixed(2))) : '';
}

export function parseColor(value: string, nullable = false): string | null | undefined {
    const text = value.trim();
    if (nullable && text.toLowerCase() === 'none') return null;
    return /^#?[\da-f]{6}$/i.test(text) ? '#' + text.replace(/^#/, '').toLowerCase() : undefined;
}
