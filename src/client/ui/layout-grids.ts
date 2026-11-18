import type { LayoutGrid, Node } from '../../shared/doc';
import type { Store } from '../store';
import './layout-grids.css';
import { defaultLayoutGrid } from '../../shared/layout-grid';
import { expand } from '../../shared/components';
import { formatNumber, inputElement, parseColor } from './values';

function gridIndex(grids: LayoutGrid[], target: number | string) {
    return typeof target === 'string' ? grids.findIndex(g => g.id === target) : grids[target]?.id === undefined ? target : -1;
}

export function removeLayoutGrid(store: Store, id: string, target: number | string) {
    const grids = expand(store.doc).get(id)?.grids ?? [], index = gridIndex(grids, target);
    if (!grids[index]) return;
    store.begin(); store.set(id, { grids: grids.filter((_, i) => i !== index) }); store.end();
}

export function editLayoutGrid(store: Store, id: string, target: number | string, key: keyof LayoutGrid, value: LayoutGrid[keyof LayoutGrid]) {
    const grids = expand(store.doc).get(id)?.grids;
    const index = gridIndex(grids ?? [], target);
    if (!grids?.[index]) return;
    store.begin();
    store.set(id, { grids: grids.map((grid, i) => i === index ? { ...grid, [key]: value } : grid) });
    store.end();
}

export function refreshLayoutGridFields(content: HTMLElement, store: Store, active: Element | null) {
    for (const input of content.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('[data-grid-node]')) {
        const grids = expand(store.doc).get(input.dataset.gridNode!)?.grids ?? [];
        const grid = grids[gridIndex(grids, input.dataset.gridId ?? Number(input.dataset.gridIndex))];
        input.disabled = !grid;
        if (!grid || input === active || !input.dataset.gridKey) continue;
        const value = grid[input.dataset.gridKey as keyof LayoutGrid];
        if (input.type === 'checkbox') (input as HTMLInputElement).checked = Boolean(value);
        else input.value = String(value);
    }
}

export function layoutGridsSection(content: HTMLElement, store: Store, node: Node) {
    const section = document.createElement('section');
    section.className = 'layout-grid-section';
    const render = () => {
        section.innerHTML = '<div class="layout-grid-heading"><div class="section-label">Layout grid</div></div>';
        const resolved = expand(store.doc).get(node.id), grids = resolved?.grids ?? [];
        const commit = (next: LayoutGrid[]) => { store.begin(); store.set(node.id, { grids: next }); store.end(); render(); };
        const add = document.createElement('button'); add.textContent = '+'; add.setAttribute('aria-label', 'Add layout grid'); add.disabled = grids.length >= 8;
        add.onclick = () => {
            const current = expand(store.doc).get(node.id);
            if (!current || (current.grids?.length ?? 0) >= 8) return;
            commit([...(current.grids ?? []), defaultLayoutGrid(current.w)]);
        };
        section.querySelector('.layout-grid-heading')!.append(add);
        grids.forEach((g, i) => {
            const target = g.id ?? i;
            const identify = (input: HTMLElement) => { input.dataset.gridNode = node.id; input.dataset.gridIndex = String(i); if (g.id !== undefined) input.dataset.gridId = g.id; };
            const fields = document.createElement('div'); fields.className = 'field-grid layout-grid-fields';
            const update = (key: keyof LayoutGrid, value: LayoutGrid[keyof LayoutGrid]) => { editLayoutGrid(store, node.id, target, key, value); render(); };
            const label = (caption: string, input: HTMLElement) => { const l = document.createElement('label'); l.className = 'field'; const s = document.createElement('span'); s.textContent = caption; input.setAttribute('aria-label', 'Grid ' + caption.toLowerCase()); identify(input); input.dataset.gridKey = caption.toLowerCase(); l.append(s, input); fields.append(l); };
            const type = document.createElement('select');
            for (const [value, title] of [['columns', 'Columns'], ['rows', 'Rows'], ['grid', 'Grid']]) type.append(new Option(title, value));
            type.value = g.type; type.onchange = () => update('type', type.value); label('Type', type);
            for (const key of [g.type === 'grid' ? 'size' : 'count', 'gutter', 'margin', 'opacity'] as const) {
                const input = inputElement('Grid ' + key); input.type = 'number'; input.value = formatNumber(g[key]); input.min = key === 'count' ? '1' : key === 'size' ? '2' : '0'; input.step = key === 'opacity' ? '.05' : '1'; if (key === 'count') input.max = '100'; if (key === 'size') input.max = '10000'; if (key === 'opacity') input.max = '1';
                input.onchange = () => { if (input.value && input.checkValidity()) update(key, Number(input.value)); }; label(key[0].toUpperCase() + key.slice(1), input);
            }
            const color = inputElement('Grid color'); color.type = 'color'; color.className = 'color-swatch'; color.value = g.color; color.onchange = () => update('color', color.value);
            const hex = inputElement('Grid color hex'); hex.value = g.color.toUpperCase(); hex.spellcheck = false;
            hex.onchange = () => { const value = parseColor(hex.value); if (value) update('color', value); };
            const colorValue = document.createElement('div'); colorValue.className = 'color-value'; colorValue.append(color, hex); label('Color', colorValue);
            delete colorValue.dataset.gridNode;
            for (const input of [color, hex]) { identify(input); input.dataset.gridKey = 'color'; }
            const visible = inputElement('Grid visible'); visible.type = 'checkbox'; visible.checked = g.visible; visible.onchange = () => update('visible', visible.checked); label('Visible', visible);
            const remove = document.createElement('button'); remove.textContent = 'Remove'; identify(remove); remove.onclick = () => { removeLayoutGrid(store, node.id, target); render(); }; fields.append(remove);
            section.append(fields);
        });
    };
    render(); content.append(section);
}
