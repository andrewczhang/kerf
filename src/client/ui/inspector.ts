import type { Store } from '../store';
import type { Sync } from '../sync';
import { styleControl, styleLibrary } from './styles';
import { arrowheads, isOpenPath, isTextNode, maskEligible, maxFontSize, strokeAlignments, strokeCaps, strokeJoins, strokeOptions, horizontalConstraints, verticalConstraints, type Node, type Key } from '../../shared/doc';
import { constraintOps } from '../../shared/constraints';
import { autoLayoutSection, sizingControl } from './autolayout';
import { fillsSection } from './fills';
import { effectsSection } from './effects';
import { downloadSelection } from '../export';
import { isAutoLayout } from '../autolayout';
import { fit, toAbs } from '../../shared/path';
import { normalizeGroups } from '../../shared/layers';
import { sizeOf, worldMatrix } from '../geometry';
import { inverse, parentMatrix, transform } from '../../shared/geometry';
import { formatNumber, inputElement, parseColor, refreshColorField } from './values';
import { layoutGridsSection, refreshLayoutGridFields } from './layout-grids';
import { codepanel } from './codepanel';
import { alignSection } from './align';
import { shortcutList } from './shortcuts';

export function refreshNumericFields(content: HTMLElement, nodes: Node[], active: Element | null) {
    if (!nodes.length) return;
    for (const input of content.querySelectorAll<HTMLInputElement>('input[type="number"][data-key]')) {
        if (input === active) continue;
        const key = input.dataset.key as Key;
        const stroke = key === 'strokeDash' || key === 'strokeGap' || key === 'strokeMiterLimit';
        const values = nodes.map(n => stroke ? strokeOptions(n)[key] : key === 'strokeWidth' && n.stroke === null ? 0 : n[key] ?? 0);
        const mixed = values.some(value => value !== values[0]);
        input.value = mixed ? '' : stroke ? String(values[0]) : formatNumber(Number(values[0]));
        input.placeholder = mixed ? 'Mixed' : '';
    }
}

export function inspector(el: HTMLElement, store: Store, sync: Sync) {
    el.innerHTML = '<div class="panel-heading" role="tablist" aria-label="Inspector"><button class="active" id="design-tab" role="tab" aria-selected="true" aria-controls="properties">Design</button><button id="code-tab" role="tab" aria-selected="false" aria-controls="code-panel">Code</button></div><div id="properties" role="tabpanel" aria-labelledby="design-tab"></div><div id="code-panel" role="tabpanel" aria-labelledby="code-tab" hidden></div>';
    const content = el.querySelector<HTMLElement>('#properties')!;
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
    let pressing = false, stale = false;
    const editing = () => !!document.activeElement?.closest('input,select,textarea') && el.contains(document.activeElement);
    el.addEventListener('pointerdown', () => { pressing = true; }, true);
    window.addEventListener('pointerup', () => { if (pressing) setTimeout(() => { pressing = false; if (stale) render(); }); }, true);
    el.addEventListener('focusout', e => { if (stale && !el.contains(e.relatedTarget as HTMLElement | null)) setTimeout(render); });
    const render = () => {
        const nodes = [...store.selection].map(id => store.doc.get(id)).filter((n): n is Node => !!n);
        if (pressing || editing()) {
            stale = true;
            refreshNumericFields(content, nodes, document.activeElement);
            refreshLayoutGridFields(content, store, document.activeElement);
            return;
        }
        stale = false;
        if (!nodes.length) {
            content.innerHTML = '<section><div class="section-label">Page</div><div class="page-color"><i></i><span>F4F3EF</span><span>100%</span></div></section><section><div class="section-label">Shortcuts</div>' + shortcutList(12) + '<p class="path-hint">Press ? for every shortcut</p></section>';
            styleLibrary(content, store, sync);
            return;
        }
        content.innerHTML = '';
        const head = document.createElement('section');
        head.className = 'layer-heading';
        const name = inputElement('Object name');
        name.className = 'name-input';
        name.value = nodes.length === 1 ? nodes[0].name : 'Multiple selection';
        name.setAttribute('aria-label', 'Object name');
        name.onchange = () => { store.begin(); for (const n of nodes)
            store.set(n.id, { name: name.value }); store.end(); };
        head.append(name);
        content.append(head);
        alignSection(content, store);
        const named = (values: readonly string[]): [string, string][] => values.map(value => [value, value[0].toUpperCase() + value.slice(1)]);
        if (nodes.every(maskEligible)) {
            const section = document.createElement('section');
            section.innerHTML = '<div class="section-label">Mask</div><label class="path-closed"><input type="checkbox" aria-label="Use as mask"> Use as mask</label>';
            const box = section.querySelector('input')!; box.checked = nodes.every(n => n.mask); box.indeterminate = nodes.some(n => !!n.mask !== !!nodes[0].mask);
            box.onchange = () => { store.begin(); for (const n of nodes) store.set(n.id, { mask: box.checked }); store.end(); box.blur(); };
            content.append(section);
        }
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
        const fields = (title: string, keys: Key[], target?: 'stroke' | 'text' | true) => { const section = document.createElement('section'); if (target === true) section.className = 'stroke-options'; section.innerHTML = `<div class="section-label">${title}</div><div class="field-grid"></div>`; const grid = section.querySelector('.field-grid')!;
        if (target && target !== true && styleControl(section, store, sync, nodes, target)) keys = keys.filter(key => !['stroke', 'fontFamily', 'fontSize', 'fontWeight'].includes(key));
        for (const key of keys) {
            const stroke = target === true;
            const label = document.createElement('label');
            label.className = 'field';
            const span = document.createElement('span');
            const caption = ({ rotation: '°', strokeWidth: 'Weight', radius: 'Radius', opacity: 'Opacity', fill: 'Fill', stroke: 'Stroke', fontFamily: 'Font', fontSize: 'Size', fontWeight: 'Weight', textAlign: 'Align', textWidth: 'Width', strokeAlign: 'Align', strokeDash: 'Dash', strokeGap: 'Gap', strokeCap: 'Cap', strokeJoin: 'Join', strokeMiterLimit: 'Miter limit', strokeStart: 'Start', strokeEnd: 'End' } as Record<string, string>)[key] ?? key.toUpperCase();
            span.textContent = caption;
            const valueOf = (n: Node) => key === 'rotation' ? n.rotation ?? 0 : n[key];
            const values = stroke ? strokeValues.map(n => n[key as keyof typeof n]) : nodes.map(valueOf);
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
                    for (const node of nodes) store.set(node.id, { [key]: chosen[0], ...(['fontFamily', 'fontWeight'].includes(key) ? { textStyle: null } : {}) });
                    store.end();
                    select.blur();
                    render();
                };
                label.append(span, select);
                grid.append(label);
                continue;
            }
            const input = inputElement(stroke ? caption : key === 'fontSize' ? 'Font size' : key === 'rotation' ? 'Rotation' : key);
            input.setAttribute('aria-label', key === 'fontSize' ? 'Font size' : key === 'rotation' ? 'Rotation' : key);
            if (key === 'rotation') input.disabled = nodes.every(n => n.type === 'group');
            input.placeholder = mixed ? 'Mixed' : '';
            const noStroke = nodes.every(n => n.stroke === null);
            if (key === 'fill' || key === 'stroke') {
                label.classList.add('color-field');
                const value = document.createElement('div'); value.className = 'color-value';
                const swatch = inputElement(`${key} color`); swatch.type = 'color'; swatch.className = 'color-swatch';
                swatch.value = String(nodes[0][key] ?? '#000000');
                if (key === 'stroke' && noStroke) {
                    swatch.classList.add('is-none');
                    swatch.title = 'No stroke. Pick a color or set a weight to add one.';
                }
                input.value = mixed ? '' : (nodes[0][key]?.toUpperCase() ?? 'None');
                input.spellcheck = false;
                input.onfocus = swatch.onfocus = () => store.begin();
                input.oninput = () => {
                    const color = parseColor(input.value, key === 'stroke');
                    input.setCustomValidity(color === undefined ? 'Use a six-digit hex color' : '');
                    if (color === undefined) return;
                    swatch.value = color ?? '#000000';
                    for (const n of nodes) store.set(n.id, { [key]: color, ...(key === 'stroke' ? { strokeStyle: null } : { fillStyle: null }) });
                };
                swatch.oninput = () => { input.value = swatch.value.toUpperCase(); for (const n of nodes) store.set(n.id, { [key]: swatch.value, ...(key === 'stroke' ? { strokeStyle: null } : { fillStyle: null }) }); };
                input.onblur = swatch.onblur = () => { store.end(); refreshColorField(input, swatch, nodes.map(n => store.doc.get(n.id)?.[key])); };
                value.append(swatch, input); label.append(span, value); grid.append(label);
                continue;
            }
            input.type = 'number';
            input.dataset.key = key;
            input.step = stroke ? 'any' : key === 'opacity' ? '.05' : '1';
            if (key === 'fontSize') input.max = String(maxFontSize);
            if (key === 'fontSize' || key === 'w' || key === 'h') input.min = '1';
            if (stroke) input.min = key === 'strokeMiterLimit' ? '1' : '0';
            input.value = key === 'strokeWidth' && noStroke ? '0' : mixed ? '' : stroke ? String(values[0]) : formatNumber(Number(values[0]));
            if (key === 'strokeWidth') input.min = '0';
            let base = store.doc;
            input.onfocus = () => { base = new Map(store.doc); store.begin(); };
            input.oninput = () => { if (!input.value || input.validity.rangeUnderflow || input.validity.rangeOverflow) return; const value = input.type === 'color' ? input.value : Number(input.value); for (const n of nodes) {
                if (key !== 'rotation' || n.type !== 'group') store.set(n.id, key === 'strokeWidth' && (store.doc.get(n.id) ?? n).stroke === null && Number(value) > 0 ? { stroke: '#000000', strokeWidth: value } : { [key]: value, ...(key === 'fontSize' ? { textStyle: null } : {}) });
                const old = base.get(n.id);
                if (old?.type === 'frame' && (key === 'w' || key === 'h') && value as number >= 1) store.commit(constraintOps(base, n.id, { w: old.w, h: old.h, [key]: value }, id => nodes.some(s => s.id === id), store.doc));
            } };
            input.onblur = () => { store.commit(normalizeGroups(store.doc, sizeOf)); store.end(); render(); };
            label.append(span, input);
            sizingControl(label, input, key, nodes, store);
            grid.append(label);
        } content.append(section); };
        if (nodes.length === 1 && nodes[0].type === 'path') {
            const n = nodes[0], section = document.createElement('section');
            section.innerHTML = `<div class="section-label">Vector</div><label class="path-closed"><input type="checkbox" aria-label="Closed path"> Closed</label><span class="path-count">${n.points?.length ?? 0} points</span><p class="path-hint">Double-click or Enter to edit points</p>`;
            const box = section.querySelector('input')!;
            box.autocomplete = 'off'; box.setAttribute('data-1p-ignore', ''); box.setAttribute('data-lpignore', 'true');
            box.checked = !!n.closed;
            box.onchange = () => {
                const f = fit(toAbs(n.points ?? [], { x: 0, y: 0, w: n.w, h: n.h }), box.checked, { x: 0, y: 0 });
                const c = transform(inverse(parentMatrix(store.doc, n)), transform(worldMatrix(store.doc, n), { x: f.x + f.w / 2, y: f.y + f.h / 2 }));
                box.blur();
                store.begin(); store.set(n.id, { x: c.x - f.w / 2, y: c.y - f.h / 2, w: f.w, h: f.h, points: f.points, closed: box.checked }); store.end();
            };
            content.append(section);
        }
        if (nodes.every(isTextNode)) {
            fields('Layout', nodes.every(node => node.textWidth === 'fixed') ? ['x', 'y', 'w', 'rotation'] : ['x', 'y', 'rotation']);
            fields('Typography', ['fontFamily', 'fontSize', 'fontWeight', 'textAlign', 'textWidth'], 'text');
            fields('Appearance', ['opacity']);
            fillsSection(content, store, nodes, section => styleControl(section, store, sync, nodes, 'fill'));
            fields('Stroke', ['stroke', 'strokeWidth'], 'stroke');
            effectsSection(content, store, nodes);
        }
        else {
            fields('Layout', nodes.some(isTextNode) ? ['x', 'y', 'rotation'] : ['x', 'y', 'w', 'h', 'rotation']);
            autoLayoutSection(content, nodes, store);
            fields('Appearance', ['radius', 'opacity']);
            fillsSection(content, store, nodes, section => styleControl(section, store, sync, nodes, 'fill'));
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
            select.onchange = () => store.set(nodes[0].id, { link: select.value || null });
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
    sync.addEventListener('styles-change', render);
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
