import { layoutDefaults, type Key, type Node, type Op } from '../../shared/doc';
import { addAutoLayout, isAutoLayout } from '../autolayout';
import type { Store } from '../store';

export function sizingControl(label: HTMLElement, input: HTMLInputElement, key: Key, nodes: Node[], store: Store): void {
    const parentAuto = (n: Node) => isAutoLayout(store.doc.get(n.parent ?? ''));
    if (key === 'x' || key === 'y') input.disabled = nodes.some(parentAuto);
    if (key !== 'w' && key !== 'h') return;
    if (key === 'h' && nodes.some(n => n.type === 'text')) { input.disabled = true; return; }
    const size = key === 'w' ? 'sizeW' : 'sizeH';
    input.disabled = nodes.some(n => (n[size] ?? 'fixed') !== 'fixed');
    const select = document.createElement('select');
    select.className = 'size-select'; select.setAttribute('aria-label', key === 'w' ? 'Width sizing' : 'Height sizing');
    const value = nodes[0][size] ?? 'fixed', mixed = nodes.some(n => (n[size] ?? 'fixed') !== value);
    const options = ['fixed', ...(nodes.every(isAutoLayout) ? ['hug'] : []), ...(nodes.every(parentAuto) ? ['fill'] : [])];
    if (mixed) select.add(new Option('Mixed', ''));
    else if (!options.includes(value)) { const option = new Option(value === 'hug' ? 'Hug' : 'Fill', value); option.disabled = true; select.add(option); }
    for (const option of options) select.add(new Option(option[0].toUpperCase() + option.slice(1), option));
    select.value = mixed ? '' : value;
    select.onchange = () => { select.blur(); store.begin(); store.commit(nodes.map(n => ({ t: 'set', id: n.id, key: size, value: select.value }) as Op)); store.end(); };
    label.append(select);
}

export function autoLayoutSection(content: HTMLElement, nodes: Node[], store: Store): void {
    if (!nodes.every(n => n.type === 'frame')) return;
    const section = document.createElement('section'); section.className = 'auto-layout';
    section.innerHTML = '<div class="section-label">Auto layout</div>';
    content.append(section);
    const change = (values: Partial<Node>) => {
        (document.activeElement as HTMLElement)?.blur();
        store.begin();
        store.commit(nodes.flatMap(n => Object.entries(values).map(([key, value]) => ({ t: 'set', id: n.id, key, value }) as Op)));
        store.end();
    };
    const button = (parent: HTMLElement, label: string, html: string, active: boolean, action: () => void) => {
        const b = document.createElement('button'); b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
        b.innerHTML = html; b.classList.toggle('active', active); b.setAttribute('aria-pressed', String(active)); b.onclick = action; parent.append(b); return b;
    };
    const enabled = nodes.every(isAutoLayout);
    if (!enabled) {
        const mixed = nodes.some(isAutoLayout);
        const b = button(section, 'Add auto layout', `${mixed ? 'Mixed — ' : ''}Add auto layout <kbd>Shift A</kbd>`, false, () => {
            b.blur(); store.begin(); for (const n of nodes) addAutoLayout(store, n); store.end();
        }); b.className = 'add-layout'; return;
    }
    const row = document.createElement('div'); row.className = 'layout-direction'; section.append(row);
    const svg = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${path}"/></svg>`;
    for (const direction of ['horizontal', 'vertical'] as const) button(row, direction === 'horizontal' ? 'Horizontal layout' : 'Vertical layout', svg(direction === 'horizontal' ? 'M4 12h16m-5-5 5 5-5 5' : 'M12 4v16m-5-5 5 5 5-5'), nodes.every(n => n.layout === direction), () => change({ layout: direction }));
    const remove = button(row, 'Remove auto layout', svg('M5 12h14'), false, () => change({ layout: 'none' })); remove.className = 'remove-layout';
    const grid = document.createElement('div'); grid.className = 'field-grid layout-fields'; section.append(grid);
    for (const key of ['gap', 'padTop', 'padRight', 'padBottom', 'padLeft'] as const) {
        const label = document.createElement('label'); label.className = 'field';
        const span = document.createElement('span'); span.textContent = { gap: 'Gap', padTop: 'T', padRight: 'R', padBottom: 'B', padLeft: 'L' }[key];
        const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.step = '1'; input.setAttribute('aria-label', key === 'gap' ? 'Gap' : `Padding ${span.textContent}`);
        const value = nodes[0][key] ?? 0, mixed = nodes.some(n => (n[key] ?? 0) !== value);
        input.value = mixed ? '' : String(value); input.placeholder = mixed ? 'Mixed' : '';
        input.onfocus = () => store.begin();
        input.oninput = () => { if (input.value === '' || !Number.isFinite(input.valueAsNumber) || input.valueAsNumber < 0) return; store.commit(nodes.map(n => ({ t: 'set', id: n.id, key, value: input.valueAsNumber }))); };
        input.onblur = () => { store.end(); store.changed(); };
        label.append(span, input); grid.append(label);
    }
    const alignment = document.createElement('div'); alignment.className = 'alignment-row'; section.append(alignment);
    const dots = document.createElement('div'); dots.className = 'alignment-grid'; dots.setAttribute('aria-label', 'Alignment'); alignment.append(dots);
    const axes = ['start', 'center', 'end'] as const;
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const matches = (n: Node) => {
            const horizontal = n.layout === 'horizontal';
            return (n.align ?? layoutDefaults.align) === axes[horizontal ? y : x] && (n.justify === 'between' || (n.justify ?? layoutDefaults.justify) === axes[horizontal ? x : y]);
        };
        button(dots, `Align ${['top', 'middle', 'bottom'][y]} ${['left', 'center', 'right'][x]}`, '<i></i>', nodes.every(matches), () => {
            (document.activeElement as HTMLElement)?.blur(); store.begin();
            store.commit(nodes.flatMap(n => {
                const horizontal = n.layout === 'horizontal';
                const ops: Op[] = [{ t: 'set', id: n.id, key: 'align', value: axes[horizontal ? y : x] }];
                if (n.justify !== 'between') ops.push({ t: 'set', id: n.id, key: 'justify', value: axes[horizontal ? x : y] });
                return ops;
            })); store.end();
        });
    }
    const between = nodes.every(n => n.justify === 'between');
    const toggle = button(alignment, 'Space between', 'Space between', between, () => change({ justify: between ? 'start' : 'between' })); toggle.className = 'space-between' + (between ? ' active' : '');
}
