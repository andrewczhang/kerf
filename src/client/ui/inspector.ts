import type { Store } from '../store';
import { downloadSelection } from '../export';
import type { Viewport } from '../viewport';
import { between, children, isTextNode, maxFontSize, type Node, type Key, type Op } from '../../shared/doc';
import { componentOps, detachOps, expand, instanceNode, isVirtual, splitVirtual } from '../../shared/components';
export function inspector(el: HTMLElement, store: Store, viewport: Viewport) {
    el.innerHTML = '<div class="panel-heading">Design <span>Properties</span></div><div id="properties"></div>';
    const content = el.querySelector<HTMLElement>('#properties')!;
    const select = (id: string) => { store.selection.clear(); store.selection.add(id); store.changed(); };
    const render = () => {
        if (el.contains(document.activeElement) && document.activeElement?.matches('input,select'))
            return;
        const doc = expand(store.doc);
        const nodes = [...store.selection].map(id => doc.get(id)).filter((n): n is Node => !!n);
        content.innerHTML = '';
        const section = (title: string) => {
            const s = document.createElement('section'), label = document.createElement('div');
            label.className = 'section-label'; label.textContent = title; s.append(label); content.append(s); return s;
        };
        const button = (parent: HTMLElement, text: string, action: () => void) => {
            const b = document.createElement('button'); b.className = 'component-action'; b.textContent = text; b.onclick = action; parent.append(b);
        };
        const insert = (main: Node, centered = false) => {
            const canvas = document.querySelector('canvas')!;
            const p = centered ? viewport.world({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }) : { x: main.x + main.w + 40, y: main.y };
            const parent = centered ? null : main.parent;
            const n = instanceNode(main, p.x, p.y, parent, between(children(store.doc, parent).at(-1)?.index ?? null));
            store.commit([{ t: 'create', node: n }]); select(n.id);
        };
        const create = () => {
            try { const { ops, id } = componentOps.create(store.doc, nodes.map(n => n.id)); store.commit(ops); select(id); } catch { }
        };
        const reset = (id: string, target?: string) => {
            const ops: Op[] = [];
            for (const [path, values] of Object.entries(store.doc.get(id)?.overrides ?? {}))
                if (target === undefined || path === target)
                    for (const key of Object.keys(values)) ops.push({ t: 'override', id, target: path, key: key as Key, value: undefined, clear: true });
            store.commit(ops);
        };
        if (!nodes.length) {
            const page = section('Page');
            page.innerHTML += '<div class="page-color"><i></i><span>F4F3EF</span><span>100%</span></div>';
            const list = section('Components');
            const mains = [...store.doc.values()].filter(n => n.component);
            for (const main of mains) button(list, main.name, () => insert(main, true));
            if (!mains.length) { const p = document.createElement('p'); p.className = 'component-note'; p.textContent = 'Select a frame or objects to create a component.'; list.append(p); }
            const shortcuts = section('Shortcuts');
            shortcuts.innerHTML += '<div class="shortcut-list"><span>Move / select</span><kbd>V</kbd><span>Frame</span><kbd>F</kbd><span>Rectangle</span><kbd>R</kbd><span>Ellipse</span><kbd>O</kbd><span>Pan canvas</span><kbd>Space</kbd></div>';
            return;
        }
        const first = nodes[0], virtual = isVirtual(first.id), owner = splitVirtual(first.id);
        const head = section(nodes.length > 1 ? nodes.length + ' objects' : virtual ? first.name + ' in ' + (store.doc.get(owner.instance)?.name ?? '') : first.instanceOf ? 'Instance' : first.component ? 'Component' : { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text' }[first.type]);
        const write = (n: Node, key: Key, value: unknown) => {
            const v = isVirtual(n.id), { instance, target } = splitVirtual(n.id);
            if (v || n.instanceOf && !['x', 'y', 'w', 'h', 'name'].includes(key))
                store.commit([{ t: 'override', id: v ? instance : n.id, target: v ? target : '', key, value }]);
            else store.set(n.id, { [key]: value });
        };
        const name = document.createElement('input'); name.className = 'name-input'; name.value = nodes.length === 1 ? first.name : 'Multiple selection'; name.setAttribute('aria-label', 'Object name');
        name.onchange = () => { store.begin(); for (const n of nodes) write(n, 'name', name.value); store.end(); };
        name.onblur = render; head.append(name);
        if (nodes.length === 1 && virtual) {
            const s = section('Instance layer');
            button(s, 'Select instance', () => select(owner.instance));
            button(s, 'Reset layer overrides', () => reset(owner.instance, owner.target));
        }
        else if (nodes.length === 1 && first.instanceOf) {
            const main = store.doc.get(first.instanceOf), s = section('Instance of ' + (main?.name ?? 'missing component'));
            if (main) button(s, 'Go to main', () => { viewport.x = 80 - main.x * viewport.zoom; viewport.y = 80 - main.y * viewport.zoom; viewport.changed(); select(main.id); });
            button(s, 'Detach', () => store.commit(detachOps(store.doc, first.id)));
            button(s, 'Reset overrides', () => reset(first.id));
        }
        else if (nodes.length === 1 && first.component) {
            const count = [...store.doc.values()].filter(n => n.instanceOf === first.id).length;
            const s = section('Component'), p = document.createElement('p'); p.className = 'component-note'; p.textContent = count + (count === 1 ? ' instance' : ' instances'); s.append(p);
            button(s, 'Create instance', () => insert(first));
        }
        else {
            try { componentOps.create(store.doc, nodes.map(n => n.id)); button(section('Component'), 'Create component', create); } catch { }
        }
        const choices: Partial<Record<Key, [string | number, string][]>> = {
            fontFamily: [['sans', 'Arial'], ['serif', 'Georgia'], ['mono', 'Monospace']],
            fontWeight: [[400, 'Regular'], [700, 'Bold']],
            textAlign: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
            textWidth: [['auto', 'Auto'], ['fixed', 'Fixed']],
        };
        const fields = (title: string, keys: Key[]) => {
            const s = section(title), grid = document.createElement('div'); grid.className = 'field-grid'; s.append(grid);
            for (const key of keys) {
                const label = document.createElement('label'); label.className = 'field';
                const span = document.createElement('span'); span.textContent = ({ strokeWidth: 'Weight', radius: 'Radius', opacity: 'Opacity', fill: 'Fill', stroke: 'Stroke', fontFamily: 'Font', fontSize: 'Size', fontWeight: 'Weight', textAlign: 'Align', textWidth: 'Width' } as Record<string, string>)[key] ?? key.toUpperCase();
                const overridden = nodes.some(n => { const { instance, target } = splitVirtual(n.id); return Object.hasOwn(store.doc.get(instance)?.overrides?.[target] ?? {}, key); });
                label.classList.toggle('overridden', overridden);
                if (overridden) label.title = 'Overridden';
                const mixed = nodes.some(n => n[key] !== first[key]), options = choices[key];
                if (options) {
                    const select = document.createElement('select'); select.setAttribute('aria-label', span.textContent);
                    if (mixed) select.append(new Option('Mixed', '', true, true));
                    for (const [value, title] of options) select.append(new Option(title, String(value), false, !mixed && first[key] === value));
                    select.onchange = () => {
                        const chosen = options.find(([value]) => String(value) === select.value);
                        if (!chosen) return;
                        store.begin(); for (const n of nodes) write(n, key, chosen[0]); store.end(); select.blur(); render();
                    };
                    label.append(span, select); grid.append(label); continue;
                }
                const input = document.createElement('input'); input.setAttribute('aria-label', key === 'fontSize' ? 'Font size' : key);
                input.readOnly = title === 'Layout' && nodes.some(n => isVirtual(n.id));
                input.placeholder = mixed ? 'Mixed' : '';
                if (key === 'fill' || key === 'stroke') { input.type = 'color'; input.value = String(first[key] ?? '#000000'); }
                else { input.type = 'number'; input.step = key === 'opacity' ? '.05' : '1'; if (key === 'fontSize') input.max = String(maxFontSize); if (key === 'fontSize' || key === 'w') input.min = '1'; input.value = mixed ? '' : String(Math.round(Number(first[key]) * 100) / 100); }
                input.onfocus = () => { if (!input.readOnly) store.begin(); };
                input.oninput = () => { if (!input.readOnly && input.value && !input.validity.rangeUnderflow && !input.validity.rangeOverflow) for (const n of nodes) write(n, key, input.type === 'color' ? input.value : Number(input.value)); };
                input.onblur = () => { store.end(); render(); };
                label.append(span, input); grid.append(label);
            }
        };
        if (nodes.every(isTextNode)) {
            fields('Layout', nodes.every(n => n.textWidth === 'fixed') ? ['x', 'y', 'w'] : ['x', 'y']);
            fields('Typography', ['fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'textWidth']);
            fields('Appearance', ['fill', 'opacity']);
        }
        else {
            fields('Layout', nodes.some(isTextNode) ? ['x', 'y'] : ['x', 'y', 'w', 'h']); fields('Appearance', ['radius', 'opacity']); fields('Fill & stroke', ['fill', 'stroke', 'strokeWidth']);
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
