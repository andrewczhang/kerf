export function inputElement(label: string): HTMLInputElement {
    const input = document.createElement('input');
    input.setAttribute('aria-label', label);
    input.autocomplete = 'off';
    input.setAttribute('data-1p-ignore', '');
    input.setAttribute('data-lpignore', 'true');
    return input;
}

export function formatNumber(value: number): string {
    return Number.isFinite(value) ? String(Number(value.toFixed(2))) : '';
}

export function parseColor(value: string, nullable = false): string | null | undefined {
    const text = value.trim();
    if (nullable && text.toLowerCase() === 'none') return null;
    return /^#?[\da-f]{6}$/i.test(text) ? '#' + text.replace(/^#/, '').toLowerCase() : undefined;
}
