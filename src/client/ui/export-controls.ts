import type { Store } from '../store';
import { downloadSelection, exportRoots, validExportScale } from '../export';

export function exportControls(parent: HTMLElement, store: Store) {
    const section = document.createElement('section');
    section.innerHTML = '<div class="section-label">Export</div><div class="export-buttons"></div><div class="export-custom"><label>PNG scale <input aria-label="PNG scale" type="number" min="0.5" max="4" step="0.5" value="1"></label><button>Export PNG</button></div><div class="export-error" role="alert"></div>';
    const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Export arrangement');
    mode.append(new Option('Combined', 'combined'), new Option('Each frame', 'each'));
    if (exportRoots(store.doc, store.selection).length > 1) section.querySelector('.section-label')!.after(mode);
    const error = section.querySelector('.export-error')!;
    const run = (format: 'png' | 'svg', scale: number) => {
        error.textContent = '';
        if (format === 'png' && !validExportScale(scale)) { error.textContent = 'PNG scale must be 0.5–4 in steps of 0.5.'; return; }
        void downloadSelection(store.doc, store.selection, format, scale, mode.value === 'each' ? 'each' : 'combined').catch(() => { error.textContent = 'Export failed. Please try again.'; });
    };
    for (const [label, format, scale] of [['PNG 1x', 'png', 1], ['PNG 2x', 'png', 2], ['SVG', 'svg', 1]] as const) {
        const button = document.createElement('button'); button.textContent = label; button.onclick = () => run(format, scale); section.querySelector('.export-buttons')!.append(button);
    }
    section.querySelector<HTMLButtonElement>('.export-custom button')!.onclick = () => run('png', Number(section.querySelector<HTMLInputElement>('.export-custom input')!.value));
    parent.append(section);
}
