import type { Store } from '../store';
import { isTextNode, maxFontSize, type Node, type Key } from '../../shared/doc';
import { autoLayoutSection, sizingControl } from './autolayout';
import { downloadSelection } from '../export';
export function inspector(el: HTMLElement, store: Store) {
    el.innerHTML = '<div class="panel-heading">Design <span>Properties</span></div><div id="properties"></div>';
    const content = el.querySelector<HTMLElement>('#properties')!;
    const render = () => {
        if (el.contains(document.activeElement) && document.activeElement?.matches('input,select'))
            return;
        const nodes = [...store.selection].map(id => store.doc.get(id)).filter((n): n is Node => !!n);
        if (!nodes.length) {
            content.innerHTML = '<section><div class="section-label">Page</div><div class="page-color"><i></i><span>F4F3EF</span><span>100%</span></div></section><section><div class="section-label">Shortcuts</div><div class="shortcut-list"><span>Move / select</span><kbd>V</kbd><span>Frame</span><kbd>F</kbd><span>Rectangle</span><kbd>R</kbd><span>Ellipse</span><kbd>O</kbd><span>Text</span><kbd>T</kbd><span>Pan canvas</span><kbd>Space</kbd></div></section>';
            return;
        }
        content.innerHTML = '';
        const head = document.createElement('section');
        head.innerHTML = `<div class="section-label">${nodes.length > 1 ? nodes.length + ' objects' : { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text' }[nodes[0].type]}</div>`;
        const name = document.createElement('input');
        name.className = 'name-input';
        name.value = nodes.length === 1 ? nodes[0].name : 'Multiple selection';
        name.setAttribute('aria-label', 'Object name');
        name.onchange = () => { store.begin(); for (const n of nodes)
            store.set(n.id, { name: name.value }); store.end(); };
        head.append(name);
        content.append(head);
        const choices: Partial<Record<Key, [string | number, string][]>> = {
            fontFamily: [['sans', 'Arial'], ['serif', 'Georgia'], ['mono', 'Monospace']],
            fontWeight: [[400, 'Regular'], [700, 'Bold']],
            textAlign: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
            textWidth: [['auto', 'Auto'], ['fixed', 'Fixed']],
        };
        const fields = (title: string, keys: Key[]) => { const section = document.createElement('section'); section.innerHTML = `<div class="section-label">${title}</div><div class="field-grid"></div>`; const grid = section.querySelector('.field-grid')!; for (const key of keys) {
            const label = document.createElement('label');
            label.className = 'field';
            const span = document.createElement('span');
            const caption = ({ strokeWidth: 'Weight', radius: 'Radius', opacity: 'Opacity', fill: 'Fill', stroke: 'Stroke', fontFamily: 'Font', fontSize: 'Size', fontWeight: 'Weight', textAlign: 'Align', textWidth: 'Width' } as Record<string, string>)[key] ?? key.toUpperCase();
            span.textContent = caption;
            const mixed = nodes.some(n => n[key] !== nodes[0][key]);
            const options = choices[key];
            if (options) {
                const select = document.createElement('select');
                select.setAttribute('aria-label', caption);
                if (mixed)
                    select.append(new Option('Mixed', '', true, true));
                for (const [value, title] of options)
                    select.append(new Option(title, String(value), false, !mixed && nodes[0][key] === value));
                select.onchange = () => {
                    const chosen = options.find(([value]) => String(value) === select.value);
                    if (!chosen) return;
                    store.begin();
                    for (const node of nodes) store.set(node.id, { [key]: chosen[0] });
                    store.end();
                    select.blur();
                    render();
                };
                label.append(span, select);
                grid.append(label);
                continue;
            }
            const input = document.createElement('input');
            input.setAttribute('aria-label', key === 'fontSize' ? 'Font size' : key);
            input.placeholder = mixed ? 'Mixed' : '';
            if (key === 'fill' || key === 'stroke') {
                input.type = 'color';
                input.value = String(nodes[0][key] ?? '#000000');
            }
            else {
                input.type = 'number';
                input.step = key === 'opacity' ? '.05' : '1';
                if (key === 'fontSize') input.max = String(maxFontSize);
                if (key === 'fontSize' || key === 'w') input.min = '1';
                input.value = mixed ? '' : String(Math.round(Number(nodes[0][key]) * 100) / 100);
            }
            input.onfocus = () => store.begin();
            input.oninput = () => { if (!input.value || input.validity.rangeUnderflow || input.validity.rangeOverflow) return; const value = input.type === 'color' ? input.value : Number(input.value); for (const n of nodes)
                store.set(n.id, { [key]: value }); };
            input.onblur = () => { store.end(); render(); };
            label.append(span, input);
            sizingControl(label, input, key, nodes, store);
            grid.append(label);
        } content.append(section); };
        if (nodes.every(isTextNode)) {
            fields('Layout', nodes.every(node => node.textWidth === 'fixed') ? ['x', 'y', 'w'] : ['x', 'y']);
            fields('Typography', ['fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'textWidth']);
            fields('Appearance', ['fill', 'opacity']);
        }
        else {
            fields('Layout', nodes.some(isTextNode) ? ['x', 'y'] : ['x', 'y', 'w', 'h']);
            autoLayoutSection(content, nodes, store);
            fields('Appearance', ['radius', 'opacity']);
            fields('Fill & stroke', ['fill', 'stroke', 'strokeWidth']);
        }
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
