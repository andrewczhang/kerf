import type { Store } from '../store';
import type { Sync } from '../sync';
import { nodeFills } from '../../shared/doc';
import { curatedPalettes, harmonies, hexRgb, rgbHex, rgbHsv, hsvRgb, rgbHsl, hslRgb, type Triple, type Palette } from '../../shared/color';
import { addColorPalette } from './styles';
import { registerCommand } from './palette';
import './color-picker.css';

export function documentColors(store: Store, sync: Sync): string[] {
    const counts = new Map<string, number>();
    const add = (color: string | null) => { if (color && /^#[\da-f]{6}$/i.test(color)) { color = color.toLowerCase(); counts.set(color, (counts.get(color) ?? 0) + 1); } };
    for (const n of store.doc.values()) { add(n.stroke); for (const p of nodeFills(n)) { if (p.type === 'solid') add(p.color); else if (p.type !== 'image') p.stops.forEach(s => add(s.color)); } }
    for (const s of sync.styles) if (s.kind === 'color') add(s.color);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([color]) => color);
}
function recentColors(): string[] { try { const value: unknown = JSON.parse(localStorage.getItem('kerf-colors') ?? '[]'); return Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string' && /^#[\da-f]{6}$/i.test(s)).slice(0, 16) : []; } catch { return []; } }
export function installColorPicker(store: Store, sync: Sync) {
    let close: (() => void) | undefined;
    for (const palette of curatedPalettes) registerCommand({ id: 'color-palette-' + palette.name, title: `Add ${palette.name} palette as color styles`, group: 'Color', enabled: () => !store.readOnly, run: () => addColorPalette(sync, palette) });
    const open = (source: HTMLInputElement) => {
        close?.(); if (source.disabled || store.readOnly) return;
        source.focus();
        const panel = document.createElement('div'); panel.className = 'color-picker'; panel.tabIndex = -1; panel.role = 'dialog'; panel.setAttribute('aria-label', 'Color picker');
        let color = source.value, hsv = rgbHsv(hexRgb(color)), mode = 'RGB', changed = false;
        const stopBlur = (e: Event) => { if (e.target === source) e.stopImmediatePropagation(); };
        document.addEventListener('blur', stopBlur, true);
        const title = document.createElement('div'); title.className = 'color-picker-title'; title.textContent = 'Color';
        const button = (text: string, action: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; return b; };
        title.append(button('×', () => close?.())); panel.append(title);
        const square = document.createElement('div'); square.className = 'color-square'; square.tabIndex = 0; square.role = 'slider'; square.setAttribute('aria-label', 'Saturation and brightness');
        const marker = document.createElement('span'); square.append(marker); panel.append(square);
        const hue = document.createElement('input'); hue.type = 'range'; hue.min = '0'; hue.max = '359'; hue.setAttribute('aria-label', 'Hue'); hue.className = 'color-hue'; panel.append(hue);
        const fields = document.createElement('div'); fields.className = 'color-channels'; panel.append(fields);
        const hex = document.createElement('input'); hex.setAttribute('aria-label', 'Hex color'); hex.maxLength = 7; fields.append(hex);
        const toggle = button(mode, () => { mode = mode === 'RGB' ? 'HSL' : 'RGB'; toggle.textContent = mode; refresh(); }); fields.append(toggle);
        const channels = [0, 1, 2].map(i => { const input = document.createElement('input'); input.type = 'number'; input.min = '0'; fields.append(input); input.oninput = () => { if (!channels.every(c => c.value !== '' && c.checkValidity())) return; const values = channels.map(c => Number(c.value)) as Triple; apply(rgbHex(mode === 'RGB' ? values : hslRgb([values[0], values[1] / 100, values[2] / 100]))); }; return input; });
        const rows = document.createElement('div'); panel.append(rows);
        const swatches = (parent: HTMLElement, name: string, colors: string[], palette?: Palette) => {
            const row = document.createElement('div'); row.className = 'color-palette-row'; const label = document.createElement('div'); label.textContent = name;
            if (palette) { const add = button('+', () => { addColorPalette(sync, palette); add.textContent = '✓'; }); add.title = `Add ${name} palette as color styles`; add.setAttribute('aria-label', add.title); label.append(add); }
            row.append(label); const strip = document.createElement('div'); strip.className = 'color-swatches';
            for (const c of colors) { const b = button('', () => apply(c)); b.style.backgroundColor = c; b.title = c; b.setAttribute('aria-label', `Use ${c}`); strip.append(b); }
            if (!colors.length) strip.textContent = 'No colors yet'; row.append(strip); parent.append(row);
        };
        const renderRows = () => { rows.replaceChildren(); swatches(rows, 'Document', documentColors(store, sync)); swatches(rows, 'Recent', recentColors()); const h = document.createElement('h3'); h.textContent = 'Harmonies'; rows.append(h); for (const p of harmonies(color)) swatches(rows, p.name, p.colors, p); const c = document.createElement('h3'); c.textContent = 'Palettes'; rows.append(c); for (const p of curatedPalettes) swatches(rows, p.name, p.colors, p); };
        function refresh() {
            square.style.backgroundColor = rgbHex(hsvRgb([hsv[0], 1, 1])); marker.style.left = `${hsv[1] * 100}%`; marker.style.top = `${(1 - hsv[2]) * 100}%`; square.setAttribute('aria-valuetext', `${Math.round(hsv[1] * 100)}% saturation, ${Math.round(hsv[2] * 100)}% brightness`); hue.value = String(hsv[0]);
            if (document.activeElement !== hex) hex.value = color.toUpperCase();
            const values = mode === 'RGB' ? hexRgb(color) : rgbHsl(hexRgb(color)).map((n, i) => i ? n * 100 : n);
            channels.forEach((input, i) => { input.max = String(mode === 'RGB' ? 255 : i ? 100 : 360); input.setAttribute('aria-label', (mode === 'RGB' ? ['Red', 'Green', 'Blue'] : ['Hue', 'Saturation', 'Lightness'])[i]); if (document.activeElement !== input) input.value = String(Math.round(values[i])); });
            if (rows.contains(document.activeElement)) panel.focus({ preventScroll: true });
            renderRows();
        }
        function apply(value: string, preserve = false) { color = value.toLowerCase(); if (!preserve) hsv = rgbHsv(hexRgb(color)); source.value = color; changed = true; source.dispatchEvent(new Event('input', { bubbles: true })); refresh(); }
        hex.oninput = () => { const value = hex.value.startsWith('#') ? hex.value : '#' + hex.value; hex.setCustomValidity(/^#[\da-f]{6}$/i.test(value) ? '' : 'Use six hex digits'); if (hex.checkValidity()) apply(value); };
        hue.oninput = () => { hsv[0] = Number(hue.value); apply(rgbHex(hsvRgb(hsv)), true); };
        const move = (e: PointerEvent) => { const r = square.getBoundingClientRect(); hsv[1] = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); hsv[2] = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); apply(rgbHex(hsvRgb(hsv)), true); };
        square.onpointerdown = e => { e.preventDefault(); square.focus(); square.setPointerCapture(e.pointerId); move(e); }; square.onpointermove = e => { if (square.hasPointerCapture(e.pointerId)) move(e); };
        square.onkeydown = e => { const delta = e.shiftKey ? .1 : .01; if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return; e.preventDefault(); hsv[1] = Math.max(0, Math.min(1, hsv[1] + (e.key === 'ArrowRight' ? delta : e.key === 'ArrowLeft' ? -delta : 0))); hsv[2] = Math.max(0, Math.min(1, hsv[2] + (e.key === 'ArrowUp' ? delta : e.key === 'ArrowDown' ? -delta : 0))); apply(rgbHex(hsvRgb(hsv)), true); };
        const EyeDropper = (window as unknown as { EyeDropper?: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper;
        if (EyeDropper) fields.append(button('Sample screen', () => { void new EyeDropper().open().then(result => { if (panel.isConnected) apply(result.sRGBHex); }).catch(() => {}); }));
        const outside = (e: PointerEvent) => { if (!panel.contains(e.target as Node) && e.target !== source) close?.(); };
        panel.onkeydown = e => e.stopPropagation();
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close?.(); } };
        close = () => { close = undefined; document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', key, true); document.removeEventListener('blur', stopBlur, true); if (changed) { try { localStorage.setItem('kerf-colors', JSON.stringify([color, ...recentColors().filter(c => c !== color)].slice(0, 16))); } catch {} source.value = color; source.dispatchEvent(new Event('change', { bubbles: true })); } source.dispatchEvent(new FocusEvent('blur')); panel.remove(); };
        (source.closest('aside') ?? document.body).append(panel); const r = source.getBoundingClientRect(); panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 296, r.left - 292))}px`; panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 600, r.top))}px`;
        refresh(); hex.focus(); document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true);
    };
    document.addEventListener('click', e => { const target = e.target; if (target instanceof HTMLInputElement && target.type === 'color') { e.preventDefault(); open(target); } }, true);
    store.addEventListener('page-leave', () => close?.());
}
