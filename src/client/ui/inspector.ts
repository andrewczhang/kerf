import type { Store } from '../store';
import type { Node, Key } from '../../shared/doc';
import { downloadSelection } from '../export';
import { formatNumber, parseColor } from './values';

function inputElement(label: string) {
    const input = document.createElement('input');
    input.setAttribute('aria-label', label);
    input.autocomplete = 'off';
    input.setAttribute('data-1p-ignore', '');
    input.setAttribute('data-lpignore', 'true');
    return input;
}

export function inspector(el: HTMLElement, store: Store) {
    el.innerHTML = '<div class="panel-heading"><span class="active">Design</span><span>Properties</span></div><div id="properties"></div>';
    const content = el.querySelector<HTMLElement>('#properties')!;
    const render = () => {
        if (el.contains(document.activeElement) && document.activeElement?.matches('input'))
            return;
        const nodes = [...store.selection].map(id => store.doc.get(id)).filter((n): n is Node => !!n);
        if (!nodes.length) {
            content.innerHTML = '<section><div class="section-label">Page</div><div class="page-color"><i></i><span>F4F3EF</span><span>100%</span></div></section><section><div class="section-label">Shortcuts</div><div class="shortcut-list"><span>Move / select</span><kbd>V</kbd><span>Frame</span><kbd>F</kbd><span>Rectangle</span><kbd>R</kbd><span>Ellipse</span><kbd>O</kbd><span>Pan canvas</span><kbd>Space</kbd></div></section>';
            return;
        }
        content.replaceChildren();
        const head = document.createElement('section');
        head.className = 'layer-heading';
        const name = inputElement('Object name');
        name.className = 'name-input';
        name.value = nodes.length === 1 ? nodes[0].name : `${nodes.length} objects`;
        name.onchange = () => {
            store.begin();
            for (const n of nodes) store.set(n.id, { name: name.value });
            store.end();
        };
        head.append(name);
        content.append(head);

        const fields = (title: string, keys: Key[]) => {
            const section = document.createElement('section');
            section.innerHTML = `<div class="section-label">${title}</div><div class="field-grid"></div>`;
            const grid = section.querySelector('.field-grid')!;
            for (const key of keys) {
                const label = document.createElement('label');
                label.className = 'field';
                const span = document.createElement('span');
                span.textContent = ({ strokeWidth: 'Weight', radius: 'Radius', opacity: 'Opacity', fill: 'Fill', stroke: 'Stroke' } as Record<string, string>)[key] ?? key.toUpperCase();
                const input = inputElement(key);
                const mixed = nodes.some(n => n[key] !== nodes[0][key]);
                input.placeholder = mixed ? 'Mixed' : '';
                label.append(span);
                const write = (value: unknown) => {
                    for (const n of nodes) store.set(n.id, { [key]: value });
                };
                const finish = () => { store.end(); };
                if (key === 'fill' || key === 'stroke') {
                    label.classList.add('color-field');
                    const value = document.createElement('div');
                    value.className = 'color-value';
                    const swatch = inputElement(`${key} color`);
                    swatch.type = 'color';
                    swatch.className = 'color-swatch';
                    swatch.value = String(nodes[0][key] ?? '#000000');
                    swatch.classList.toggle('no-color', nodes[0][key] === null);
                    input.value = mixed ? '' : (nodes[0][key]?.toString().toUpperCase() ?? 'None');
                    input.spellcheck = false;
                    input.onfocus = () => store.begin();
                    input.oninput = () => {
                        const color = parseColor(input.value, key === 'stroke');
                        input.setCustomValidity(color === undefined ? 'Use a six-digit hex color' : '');
                        if (color === undefined) return;
                        swatch.value = color ?? '#000000';
                        swatch.classList.toggle('no-color', color === null);
                        write(color);
                    };
                    input.onblur = () => {
                        finish();
                        input.setCustomValidity('');
                        const current = store.doc.get(nodes[0].id)?.[key];
                        input.value = nodes.some(n => store.doc.get(n.id)?.[key] !== current) ? '' : current?.toUpperCase() ?? 'None';
                    };
                    swatch.onfocus = () => store.begin();
                    swatch.oninput = () => {
                        input.value = swatch.value.toUpperCase();
                        swatch.classList.remove('no-color');
                        write(swatch.value);
                    };
                    swatch.onblur = finish;
                    value.append(swatch, input);
                    label.append(value);
                } else {
                    input.type = 'number';
                    input.step = key === 'opacity' ? '.05' : '1';
                    input.value = mixed ? '' : formatNumber(Number(nodes[0][key]));
                    input.onfocus = () => store.begin();
                    input.oninput = () => {
                        if (input.value !== '' && Number.isFinite(input.valueAsNumber)) write(input.valueAsNumber);
                    };
                    input.onblur = () => {
                        finish();
                        const current = Number(store.doc.get(nodes[0].id)?.[key]);
                        input.value = nodes.some(n => store.doc.get(n.id)?.[key] !== current) ? '' : formatNumber(current);
                    };
                    label.append(input);
                }
                grid.append(label);
            }
            content.append(section);
        };
        fields('Layout', ['x', 'y', 'w', 'h']);
        fields('Appearance', ['radius', 'opacity']);
        fields('Fill & stroke', ['fill', 'stroke', 'strokeWidth']);
        const exports = document.createElement('section');
        exports.innerHTML = '<div class="section-label">Export</div><div class="export-buttons"></div><div class="export-error" role="alert"></div>';
        for (const [label, format, scale] of [['PNG 1x', 'png', 1], ['PNG 2x', 'png', 2], ['SVG', 'svg', 1]] as const) {
            const button = document.createElement('button');
            button.textContent = label;
            button.onclick = () => {
                exports.querySelector('.export-error')!.textContent = '';
                void downloadSelection(store.doc, store.selection, format, scale).catch(() => {
                    exports.querySelector('.export-error')!.textContent = 'Export failed. Please try again.';
                });
            };
            exports.querySelector('.export-buttons')!.append(button);
        }
        content.append(exports);
    };
    store.addEventListener('change', render);
    render();
}
