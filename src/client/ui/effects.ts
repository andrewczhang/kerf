import type { Effect, Node } from '../../shared/doc';
import type { Store } from '../store';
import { button, eye, field, select, transaction } from './paint-controls';
const expanded = new WeakMap<Store, number>();
export function effectsSection(parent: HTMLElement, store: Store, nodes: Node[]) {
    const section = document.createElement('section'); section.className = 'paint-section'; parent.append(section);
    const render = () => {
        section.replaceChildren(); const effects = structuredClone(store.doc.get(nodes[0].id)?.effects ?? []), apply = (next: Effect[]) => { for (const n of nodes) store.set(n.id, { effects: structuredClone(next) }); }, act = (edit: () => void) => { transaction(store, edit); render(); }, update = (i: number, e: Effect) => { if (effects[i].type === e.type) Object.assign(effects[i], e); else effects[i] = e; apply(effects); };
        const heading = document.createElement('div'); heading.className = 'paint-heading'; heading.append('Effects', button('+', () => act(() => { if (effects.length < 8) { expanded.set(store, effects.length); apply([...effects, { type: 'drop-shadow', x: 0, y: 4, blur: 12, spread: 0, color: '#000000', opacity: .25, visible: true }]); } }))); section.append(heading);
        if (nodes.some(n => JSON.stringify(store.doc.get(n.id)?.effects ?? []) !== JSON.stringify(effects))) { const mixed = document.createElement('div'); mixed.className = 'paint-mixed'; mixed.append('Mixed', button('Replace all', () => act(() => apply(effects)))); section.append(mixed); return; }
        effects.forEach((e, i) => {
            const row = document.createElement('div'); row.className = 'paint-row'; const open = expanded.get(store) === i; row.append(button(open ? '− Editor' : '+ Editor', () => { expanded.set(store, open ? -1 : i); render(); }), select(e.type, [['drop-shadow', 'Drop shadow'], ['inner-shadow', 'Inner shadow'], ['layer-blur', 'Layer blur'], ['background-blur', 'Background blur']], type => act(() => { expanded.set(store, i); update(i, type === 'layer-blur' || type === 'background-blur' ? { type, radius: 'radius' in e ? e.radius : e.blur, visible: e.visible } : { type, x: 'x' in e ? e.x : 0, y: 'y' in e ? e.y : 4, blur: 'blur' in e ? e.blur : e.radius, spread: 'spread' in e ? e.spread : 0, color: 'color' in e ? e.color : '#000000', opacity: 'opacity' in e ? e.opacity : .25, visible: e.visible }); })), button(e.visible ? 'Hide effect' : 'Show effect', () => act(() => update(i, { ...e, visible: !e.visible })), eye(e.visible)), button('−', () => act(() => { effects.splice(i, 1); apply(effects); }))); row.querySelector('select')!.style.flex = '1'; section.append(row);
            if (!open) return; const editor = document.createElement('div'); editor.className = 'paint-editor'; section.append(editor);
            if (e.type === 'layer-blur' || e.type === 'background-blur') field(editor, 'Radius', e.radius, 'number', store, value => update(i, { ...e, radius: Number(value) }), render, 0);
            else { for (const key of ['x', 'y', 'blur', 'spread'] as const) field(editor, key === 'x' || key === 'y' ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1), e[key], 'number', store, value => { e[key] = Number(value); update(i, { ...e }); }, render, key === 'blur' ? 0 : undefined); field(editor, 'Color', e.color, 'color', store, value => { e.color = value; update(i, { ...e }); }, render); field(editor, 'Opacity %', e.opacity * 100, 'number', store, value => { e.opacity = Number(value) / 100; update(i, { ...e }); }, render, 0, 100); }
        });
    }; render();
}
