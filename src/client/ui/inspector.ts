import type { Store } from '../store';
import type { Sync } from '../sync';
import { styleControl, styleLibrary } from './styles';
import { arrowheads, isOpenPath, strokeAlignments, strokeCaps, strokeJoins, strokeOptions, horizontalConstraints, verticalConstraints } from '../../shared/doc';
import { constraintOps } from '../../shared/constraints';
import { autoLayoutSection, sizingControl } from './autolayout';
import { fillsSection } from './fills';
import { effectsSection } from './effects';
import { downloadSelection } from '../export';
import { sizeOf, world } from '../geometry';
import { isAutoLayout } from '../autolayout';
import { fit, toAbs } from '../../shared/path';
import type { Viewport } from '../viewport';
import { between, children, isTextNode, maxFontSize, type Node, type Key, type Op } from '../../shared/doc';
import { componentOps, detachOps, expand, instanceNode, isVirtual, splitVirtual } from '../../shared/components';
import { formatNumber, inputElement, parseColor, refreshColorField } from './values';
import { layoutGridsSection, refreshLayoutGridFields } from './layout-grids';
import { codepanel } from './codepanel';
import { alignSection } from './align';

export function refreshNumericFields(content: HTMLElement, nodes: Node[], active: Element | null) {
    if (!nodes.length) return;
    for (const input of content.querySelectorAll<HTMLInputElement>('input[type="number"][data-key]')) {
        if (input === active) continue;
        const key = input.dataset.key as Key;
        const stroke = key === 'strokeDash' || key === 'strokeGap' || key === 'strokeMiterLimit';
        const values = nodes.map(n => stroke ? strokeOptions(n)[key] : n[key] ?? 0);
        const mixed = values.some(value => value !== values[0]);
        input.value = mixed ? '' : stroke ? String(values[0]) : formatNumber(Number(values[0]));
        input.placeholder = mixed ? 'Mixed' : '';
    }
}

export function refreshFocusedInspector(content: HTMLElement, nodes: Node[], active: Element | null): boolean {
    const selection = JSON.stringify(nodes.map(n => n.id)), same = content.dataset.selection === selection;
    content.dataset.selection = selection;
    if (!active || !same) return false;
    refreshNumericFields(content, nodes, active);
    return true;
}

export function inspector(el: HTMLElement, store: Store, viewport: Viewport, sync?: Sync) {
    el.innerHTML = '<div class="panel-heading" role="tablist" aria-label="Inspector"><button class="active" id="design-tab" role="tab" aria-selected="true" aria-controls="properties">Design</button><button id="code-tab" role="tab" aria-selected="false" aria-controls="code-panel">Code</button></div><div id="properties" role="tabpanel" aria-labelledby="design-tab"></div><div id="code-panel" role="tabpanel" aria-labelledby="code-tab" hidden></div>';
    const content = el.querySelector<HTMLElement>('#properties')!;
    const select = (id: string) => { store.selection.clear(); store.selection.add(id); store.changed(); };
    const code = codepanel(el.querySelector<HTMLElement>('#code-panel')!, store);
    const setTab = (codeActive: boolean) => {
        for (const id of ['design', 'code']) {
            const button = el.querySelector<HTMLButtonElement>(`#${id}-tab`)!;
            const active = (id === 'code') === codeActive;
            button.classList.toggle('active', active);
            button.setAttribute('aria-selected', String(active));
        }
        content.hidden = codeActive;
        code.activate(codeActive);
    };
    el.querySelector<HTMLButtonElement>('#design-tab')!.onclick = () => setTab(false);
    el.querySelector<HTMLButtonElement>('#code-tab')!.onclick = () => setTab(true);
    const render = () => {
        const doc = expand(store.doc);
        const nodes = [...store.selection].map(id => doc.get(id)).filter((n): n is Node => !!n);
        if (refreshFocusedInspector(content, nodes, el.contains(document.activeElement) ? document.activeElement : null)) {
            refreshLayoutGridFields(content, store, document.activeElement);
            return;
        }
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
            try { const { ops, id } = componentOps.create(store.doc, nodes.map(n => n.id), sizeOf); if (!ops.length) return; store.commit(ops); select(id); } catch { }
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
            shortcuts.innerHTML += '<div class="shortcut-list"><span>Move / select</span><kbd>V</kbd><span>Frame</span><kbd>F</kbd><span>Rectangle</span><kbd>R</kbd><span>Ellipse</span><kbd>O</kbd><span>Text</span><kbd>T</kbd><span>Pen</span><kbd>P</kbd><span>Pan canvas</span><kbd>Space</kbd></div>';
            if (sync) styleLibrary(content, store, sync);
            return;
        }
        const first = nodes[0], virtual = isVirtual(first.id), owner = splitVirtual(first.id);
        const head = section(nodes.length > 1 ? nodes.length + ' objects' : virtual ? first.name + ' in ' + (store.doc.get(owner.instance)?.name ?? '') : first.instanceOf ? 'Instance' : first.component ? 'Component' : { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', text: 'Text', path: 'Path', group: 'Group' }[first.type]);
        const write = (n: Node, key: Key, value: unknown) => {
            const v = isVirtual(n.id), { instance, target } = splitVirtual(n.id);
            if (v || n.instanceOf && !['x', 'y', 'w', 'h', 'name'].includes(key))
                store.commit([{ t: 'override', id: v ? instance : n.id, target: v ? target : '', key, value }]);
            else store.set(n.id, { [key]: value });
        };
        head.classList.add('layer-heading');
        const name = inputElement('Object name'); name.className = 'name-input'; name.value = nodes.length === 1 ? first.name : 'Multiple selection'; name.setAttribute('aria-label', 'Object name');
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
            try { componentOps.create(store.doc, nodes.map(n => n.id), sizeOf); button(section('Component'), 'Create component', create); } catch { }
        }
        alignSection(content, store);
        const named = (values: readonly string[]): [string, string][] => values.map(value => [value, value[0].toUpperCase() + value.slice(1)]);
        const choices: Partial<Record<Key, [string | number, string][]>> = {
            fontFamily: [['sans', 'Arial'], ['serif', 'Georgia'], ['mono', 'Monospace']],
            fontWeight: [[400, 'Regular'], [700, 'Bold']],
            textAlign: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
            textWidth: [['auto', 'Auto'], ['fixed', 'Fixed']],
            strokeAlign: named(strokeAlignments),
            strokeCap: named(strokeCaps),
            strokeJoin: named(strokeJoins),
            strokeStart: named(arrowheads),
            strokeEnd: named(arrowheads),
        };
        const strokeValues = nodes.map(strokeOptions);
        const fields = (title: string, keys: Key[], target?: 'stroke' | 'text' | true) => { const stroke = target === true, s = section(title); if (stroke) s.className = 'stroke-options'; const grid = document.createElement('div'); grid.className = 'field-grid'; s.append(grid); if (sync && target && target !== true && styleControl(s, store, sync, nodes, target)) keys = keys.filter(key => !['stroke', 'fontFamily', 'fontSize', 'fontWeight'].includes(key)); for (const key of keys) {
            const label = document.createElement('label');
            label.className = 'field';
            const overridden = nodes.some(n => { const { instance, target } = splitVirtual(n.id); return Object.hasOwn(store.doc.get(instance)?.overrides?.[target] ?? {}, key); });
            label.classList.toggle('overridden', overridden);
            if (overridden) label.title = 'Overridden';
            const span = document.createElement('span');
            const caption = ({ strokeWidth: 'Weight', radius: 'Radius', opacity: 'Opacity', fill: 'Fill', stroke: 'Stroke', fontFamily: 'Font', fontSize: 'Size', fontWeight: 'Weight', textAlign: 'Align', textWidth: 'Width', strokeAlign: 'Align', strokeDash: 'Dash', strokeGap: 'Gap', strokeCap: 'Cap', strokeJoin: 'Join', strokeMiterLimit: 'Miter limit', strokeStart: 'Start', strokeEnd: 'End' } as Record<string, string>)[key] ?? key.toUpperCase();
            span.textContent = caption;
            const values = stroke ? strokeValues.map(n => n[key as keyof typeof n]) : nodes.map(n => n[key]);
            const mixed = values.some(value => value !== values[0]);
            const options = choices[key];
            if (options) {
                const select = document.createElement('select');
                select.setAttribute('aria-label', caption);
                if (mixed)
                    select.append(new Option('Mixed', '', true, true));
                for (const [value, title] of options)
                    select.append(new Option(title, String(value), false, !mixed && values[0] === value));
                select.onchange = () => {
                    const chosen = options.find(([value]) => String(value) === select.value);
                    if (!chosen) return;
                    store.begin();
                    for (const node of nodes) { write(node, key, chosen[0]); if (['fontFamily', 'fontWeight'].includes(key)) write(node, 'textStyle', null); }
                    store.end();
                    select.blur();
                    render();
                };
                label.append(span, select);
                grid.append(label);
                continue;
            }
            const input = inputElement(stroke ? caption : key === 'fontSize' ? 'Font size' : key);
            input.placeholder = mixed ? 'Mixed' : '';
            if (key === 'fill' || key === 'stroke') {
                label.classList.add('color-field');
                const value = document.createElement('div'); value.className = 'color-value';
                const swatch = inputElement(`${key} color`); swatch.type = 'color'; swatch.className = 'color-swatch';
                swatch.value = String(nodes[0][key] ?? '#000000');
                input.value = mixed ? '' : (nodes[0][key]?.toUpperCase() ?? 'None');
                input.spellcheck = false;
                input.onfocus = swatch.onfocus = () => store.begin();
                input.oninput = () => {
                    const color = parseColor(input.value, key === 'stroke');
                    input.setCustomValidity(color === undefined ? 'Use a six-digit hex color' : '');
                    if (color === undefined) return;
                    swatch.value = color ?? '#000000';
                    for (const n of nodes) { write(n, key, color); write(n, key === 'stroke' ? 'strokeStyle' : 'fillStyle', null); }
                };
                swatch.oninput = () => { input.value = swatch.value.toUpperCase(); for (const n of nodes) { write(n, key, swatch.value); write(n, key === 'stroke' ? 'strokeStyle' : 'fillStyle', null); } };
                input.onblur = swatch.onblur = () => { store.end(); refreshColorField(input, swatch, nodes.map(n => expand(store.doc).get(n.id)?.[key])); };
                value.append(swatch, input); label.append(span, value); grid.append(label);
                continue;
            }
            input.readOnly = title === 'Layout' && nodes.some(n => isVirtual(n.id));
            input.type = 'number';
            input.dataset.key = key;
            input.step = stroke ? 'any' : key === 'opacity' ? '.05' : '1';
            if (key === 'fontSize') input.max = String(maxFontSize);
            if (key === 'fontSize' || key === 'w' || key === 'h') input.min = '1';
            if (stroke) input.min = key === 'strokeMiterLimit' ? '1' : '0';
            input.value = mixed ? '' : stroke ? String(values[0]) : formatNumber(Number(nodes[0][key]));
            let base = store.doc;
            input.onfocus = () => { if (!input.readOnly) { base = new Map(store.doc); store.begin(); } };
            input.oninput = () => { if (input.readOnly || !input.value || input.validity.rangeUnderflow || input.validity.rangeOverflow) return; const value = input.type === 'color' ? input.value : Number(input.value); for (const n of nodes) {
                write(n, key, value); if (key === 'fontSize') write(n, 'textStyle', null);
                const old = base.get(n.id);
                if (old?.type === 'frame' && (key === 'w' || key === 'h') && value as number >= 1) store.commit(constraintOps(base, n.id, { w: old.w, h: old.h, [key]: value }, id => nodes.some(s => s.id === id), store.doc));
            } };
            input.onblur = () => { store.end(); render(); };
            label.append(span, input);
            if (!input.readOnly) sizingControl(label, input, key, nodes, store);
            grid.append(label);
        }
        };
        if (nodes.length === 1 && first.type === 'path') {
            const s = section('Vector');
            s.innerHTML += `<label class="path-closed"><input type="checkbox" aria-label="Closed path"> Closed</label><span class="path-count">${first.points?.length ?? 0} points</span>${virtual ? '' : '<p class="path-hint">Double-click or Enter to edit points</p>'}`;
            const box = s.querySelector('input')!;
            box.autocomplete = 'off'; box.setAttribute('data-1p-ignore', ''); box.setAttribute('data-lpignore', 'true');
            box.checked = !!first.closed;
            box.onchange = () => {
                box.blur();
                store.begin();
                if (virtual) write(first, 'closed', box.checked);
                else {
                    const parent = first.parent ? store.doc.get(first.parent) : undefined, origin = parent ? world(store.doc, parent) : { x: 0, y: 0 };
                    const f = fit(toAbs(first.points ?? [], world(store.doc, first)), box.checked, origin);
                    store.set(first.id, { x: f.x, y: f.y, w: f.w, h: f.h, points: f.points, closed: box.checked });
                }
                store.end();
            };
        }
        if (nodes.every(isTextNode)) {
            fields('Layout', nodes.every(node => node.textWidth === 'fixed') ? ['x', 'y', 'w'] : ['x', 'y']);
            fields('Typography', ['fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'textWidth'], 'text');
            fields('Appearance', ['opacity']);
            fillsSection(content, store, nodes, section => sync ? styleControl(section, store, sync, nodes, 'fill') : false);
            fields('Stroke', ['stroke', 'strokeWidth'], 'stroke');
            effectsSection(content, store, nodes);
        }
        else {
            fields('Layout', nodes.some(isTextNode) ? ['x', 'y'] : ['x', 'y', 'w', 'h']);
            if (!virtual) autoLayoutSection(content, nodes, store);
            fields('Appearance', ['radius', 'opacity']);
            fillsSection(content, store, nodes, section => sync ? styleControl(section, store, sync, nodes, 'fill') : false);
            fields('Stroke', ['stroke', 'strokeWidth'], 'stroke');
            if (nodes.every(n => n.type !== 'text' && n.type !== 'group')) {
                const keys: Key[] = ['strokeDash', 'strokeGap', 'strokeCap', 'strokeJoin'];
                if (nodes.every(n => !isOpenPath(n))) keys.unshift('strokeAlign');
                if (strokeValues.some(n => n.strokeJoin === 'miter')) keys.push('strokeMiterLimit');
                if (nodes.every(isOpenPath)) keys.push('strokeStart', 'strokeEnd');
                fields('Stroke options', keys, true);
            }
            effectsSection(content, store, nodes);
        }
        if (nodes.length === 1 && nodes[0].type === 'frame') layoutGridsSection(content, store, nodes[0]);
        if (nodes.every(n => { const p = n.parent ? store.doc.get(n.parent) : undefined; return p?.type === 'frame' && !isAutoLayout(p); }))
            content.append(constraints(store, nodes, render));
        if (nodes.length === 1) {
            const section = document.createElement('section');
            section.innerHTML = '<div class="section-label">Prototype</div><label>On click → navigate to </label>';
            const select = document.createElement('select');
            select.setAttribute('aria-label', 'Prototype target');
            select.append(new Option('None', ''));
            for (const frame of store.doc.values()) if (frame.type === 'frame' && !frame.parent) select.append(new Option(frame.name, frame.id));
            select.value = nodes[0].link ?? '';
            select.onchange = () => write(first, 'link', select.value || null);
            section.append(select); content.append(section);
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
    sync?.addEventListener('styles-change', render);
    el.addEventListener('focusout', () => setTimeout(render, 0));
    render();
}

const hLabels: Record<typeof horizontalConstraints[number], string> = { left: 'Left', right: 'Right', both: 'Left & right', center: 'Center', scale: 'Scale' };
const vLabels: Record<typeof verticalConstraints[number], string> = { top: 'Top', bottom: 'Bottom', both: 'Top & bottom', center: 'Center', scale: 'Scale' };
function constraints(store: Store, nodes: Node[], render: () => void): HTMLElement {
    const section = document.createElement('section');
    section.className = 'constraints';
    const h = nodes.map(n => n.constraintH ?? 'left'), v = nodes.map(n => n.constraintV ?? 'top');
    const hValue = h.every(c => c === h[0]) ? h[0] : null, vValue = v.every(c => c === v[0]) ? v[0] : null;
    const apply = (values: Partial<Node>) => { store.begin(); for (const n of nodes) store.set(n.id, values); store.end(); render(); };
    const on = (axis: 'h' | 'v', side: string) => { const value = axis === 'h' ? hValue : vValue; return value === side || value === 'both' && side !== 'center' && side !== 'scale'; };
    // Diagram: outer square is the frame, inner square is the layer; bars are the pins.
    const bars: [string, 'h' | 'v', string, string][] = [
        ['Pin left', 'h', 'left', 'M4 28H17'], ['Pin right', 'h', 'right', 'M39 28H52'], ['Pin top', 'v', 'top', 'M28 4V17'], ['Pin bottom', 'v', 'bottom', 'M28 39V52'],
        ['Center horizontally', 'h', 'center', 'M24 28H32'], ['Center vertically', 'v', 'center', 'M28 24V32'],
    ];
    section.innerHTML = `<div class="section-label">Constraints</div><div class="constraint-body"><svg class="constraint-pins" viewBox="0 0 56 56" role="group" aria-label="Constraint pins"><rect x="0.5" y="0.5" width="55" height="55"/><rect class="inner" x="17.5" y="17.5" width="21" height="21"/>${bars.map(([label, axis, side, d]) => `<path class="pin${on(axis, side) ? ' on' : ''}" data-axis="${axis}" data-side="${side}" d="${d}"><title>${label}</title></path><path class="pin-hit" data-axis="${axis}" data-side="${side}" d="${d}" role="button" aria-label="${label}" aria-pressed="${on(axis, side)}"/>`).join('')}</svg><div class="constraint-fields"></div></div>`;
    for (const hit of section.querySelectorAll<SVGPathElement>('.pin-hit')) hit.addEventListener('click', e => {
        const axis = hit.dataset.axis as 'h' | 'v', side = hit.dataset.side!, value = axis === 'h' ? hValue : vValue;
        const [start, end] = axis === 'h' ? ['left', 'right'] : ['top', 'bottom'];
        let next = side;
        if (e.shiftKey && side !== 'center' && (value === start || value === end) && value !== side) next = 'both';
        else if (e.shiftKey && value === 'both' && side !== 'center') next = side === start ? end : start;
        apply(axis === 'h' ? { constraintH: next as Node['constraintH'] } : { constraintV: next as Node['constraintV'] });
    });
    const fields = section.querySelector('.constraint-fields')!;
    for (const [axis, caption, labels, value] of [['h', 'Horizontal', hLabels, hValue], ['v', 'Vertical', vLabels, vValue]] as const) {
        const label = document.createElement('label'), span = document.createElement('span'), select = document.createElement('select');
        label.className = 'field';
        span.textContent = caption[0];
        select.setAttribute('aria-label', caption + ' constraint');
        if (value === null) select.append(new Option('Mixed', '', true, true));
        for (const [key, title] of Object.entries(labels)) select.append(new Option(title, key, false, key === value));
        select.onchange = () => { if (!select.value) return; select.blur(); apply(axis === 'h' ? { constraintH: select.value as Node['constraintH'] } : { constraintV: select.value as Node['constraintV'] }); };
        label.append(span, select);
        fields.append(label);
    }
    return section;
}
