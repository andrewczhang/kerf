import type { LayoutGrid, Node } from '../../shared/doc';
import type { Store } from '../store';
import './layout-grids.css';
import { defaultLayoutGrid } from '../../shared/layout-grid';
import { expand } from '../../shared/components';

export function layoutGridsSection(content: HTMLElement, store: Store, node: Node) {
    const section = document.createElement('section');
    const render = () => {
        section.innerHTML = '<div class="section-label">Layout grid</div>';
        const resolved = expand(store.doc).get(node.id), grids = resolved?.grids ?? [];
        const commit = (next: LayoutGrid[]) => { store.begin(); store.set(node.id, { grids: next }); store.end(); render(); };
        const add = document.createElement('button'); add.textContent = '+'; add.setAttribute('aria-label', 'Add layout grid'); add.disabled = grids.length >= 8;
        add.onclick = () => commit([...grids, defaultLayoutGrid(resolved?.w ?? node.w)]);
        section.append(add);
        grids.forEach((g, i) => {
            const fields = document.createElement('div'); fields.className = 'field-grid layout-grid-fields';
            const update = (key: keyof LayoutGrid, value: unknown) => commit(grids.map((v, j) => j === i ? { ...v, [key]: value } : v));
            const label = (caption: string, input: HTMLElement) => { const l = document.createElement('label'); l.className = 'field'; const s = document.createElement('span'); s.textContent = caption; input.setAttribute('aria-label', 'Grid ' + caption.toLowerCase()); l.append(s, input); fields.append(l); };
            const type = document.createElement('select');
            for (const [value, title] of [['columns', 'Columns'], ['rows', 'Rows'], ['grid', 'Grid']]) type.append(new Option(title, value));
            type.value = g.type; type.onchange = () => update('type', type.value); label('Type', type);
            for (const key of [g.type === 'grid' ? 'size' : 'count', 'gutter', 'margin', 'opacity'] as const) {
                const input = document.createElement('input'); input.type = 'number'; input.value = String(g[key]); input.min = key === 'count' ? '1' : key === 'size' ? '2' : '0'; input.step = key === 'opacity' ? '.05' : '1'; if (key === 'count') input.max = '100'; if (key === 'size') input.max = '10000'; if (key === 'opacity') input.max = '1';
                input.onchange = () => { if (input.value && input.checkValidity()) update(key, Number(input.value)); }; label(key[0].toUpperCase() + key.slice(1), input);
            }
            const color = document.createElement('input'); color.type = 'color'; color.value = g.color; color.onchange = () => update('color', color.value); label('Color', color);
            const visible = document.createElement('input'); visible.type = 'checkbox'; visible.checked = g.visible; visible.onchange = () => update('visible', visible.checked); label('Visible', visible);
            const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.onclick = () => commit(grids.filter((_, j) => j !== i)); fields.append(remove);
            section.append(fields);
        });
    };
    render(); content.append(section);
}
