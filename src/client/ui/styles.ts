import type { Sync } from '../sync';
import type { Store } from '../store';
import { isTextNode, maxFontSize, textFonts, textWeights, type Node } from '../../shared/doc';
import { styleValues, validStyle, type Style } from '../../shared/styles';
import './styles.css';
const fonts = { sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace' };
function button(text: string, action: () => void) { const b = document.createElement('button'); b.textContent = text; b.onclick = () => { b.blur(); action(); }; return b; }
function create(sync: Sync, kind: Style['kind'], node?: Node, target = 'fill') {
    const base = { id: crypto.randomUUID(), name: kind === 'color' ? 'Color style' : 'Text style' };
    const style: Style = kind === 'color' ? { ...base, kind, color: (target === 'stroke' ? node?.stroke : node?.fill) ?? '#ff4f00' } : { ...base, kind, fontFamily: node?.fontFamily ?? 'sans', fontSize: node?.fontSize ?? 24, fontWeight: node?.fontWeight ?? 400 };
    sync.send({ type: 'style-upsert', style }); return style;
}
export function styleLibrary(parent: HTMLElement, store: Store, sync: Sync) {
    const title = document.createElement('section'); title.textContent = 'Local styles'; parent.append(title);
    for (const kind of ['color', 'text'] as const) {
        const section = document.createElement('section'), heading = document.createElement('div'); heading.className = 'style-heading'; heading.append(kind === 'color' ? 'Colors' : 'Text', button('+', () => create(sync, kind))); section.append(heading); parent.append(section);
        const styles = sync.styles.filter(s => s.kind === kind);
        if (!styles.length) { const empty = document.createElement('p'); empty.className = 'style-empty'; empty.textContent = 'No styles yet'; section.append(empty); }
        for (const style of styles) {
            const row = document.createElement('button'); row.className = 'style-row';
            const sample = document.createElement('span'); sample.className = 'style-sample';
            if (style.kind === 'color') sample.style.backgroundColor = style.color;
            else { sample.textContent = 'Ag'; sample.style.fontFamily = fonts[style.fontFamily]; sample.style.fontWeight = String(style.fontWeight); }
            const label = document.createElement('span'), name = document.createElement('span'), spec = document.createElement('small'); name.textContent = style.name;
            const count = [...store.doc.values()].filter(n => n.fillStyle === style.id || n.strokeStyle === style.id || n.textStyle === style.id).length;
            spec.textContent = (style.kind === 'color' ? style.color : `${style.fontFamily} ${style.fontSize} · ${style.fontWeight}`) + ` · ${count} layers`;
            label.append(name, spec); row.append(sample, label); section.append(row);
            row.onclick = () => {
                if (row.nextElementSibling?.classList.contains('style-editor')) { row.nextElementSibling.remove(); return; }
                const editor = document.createElement('div'); editor.className = 'style-editor'; row.after(editor); let draft = { ...style }; let timer: ReturnType<typeof setTimeout>;
                const send = () => { if (validStyle(draft)) sync.send({ type: 'style-upsert', style: draft }); };
                const input = (key: string, type: string, value: string) => { const label = document.createElement('label'); label.textContent = key === 'fontSize' ? 'Size' : key === 'fontFamily' ? 'Font' : key === 'fontWeight' ? 'Weight' : key; const field = document.createElement('input'); field.type = type; field.value = value; field.setAttribute('aria-label', 'Style ' + key); if (key === 'fontSize') { field.min = '1'; field.max = String(maxFontSize); } field.oninput = () => { draft = { ...draft, [key]: type === 'number' ? Number(field.value) : field.value }; clearTimeout(timer); if (type === 'color') send(); else timer = setTimeout(send, 250); }; field.onchange = () => { clearTimeout(timer); send(); }; label.append(field); editor.append(label); };
                input('name', 'text', style.name);
                if (style.kind === 'color') input('color', 'color', style.color);
                else {
                    for (const [key, values] of [['fontFamily', textFonts], ['fontWeight', textWeights]] as const) { const label = document.createElement('label'); label.textContent = key === 'fontFamily' ? 'Font' : 'Weight'; const select = document.createElement('select'); select.setAttribute('aria-label', 'Style ' + key); for (const value of values) select.append(new Option(String(value), String(value))); select.value = String(style[key]); select.onchange = () => { draft = { ...draft, [key]: key === 'fontWeight' ? Number(select.value) : select.value }; send(); }; label.append(select); editor.append(label); }
                    input('fontSize', 'number', String(style.fontSize));
                }
                editor.append(button('Delete style', () => { clearTimeout(timer); sync.send({ type: 'style-delete', id: style.id }); editor.remove(); }));
            };
        }
    }
}
export function styleControl(parent: HTMLElement, store: Store, sync: Sync, nodes: Node[], target: 'fill' | 'stroke' | 'text'): boolean {
    const key = target === 'fill' ? 'fillStyle' : target === 'stroke' ? 'strokeStyle' : 'textStyle', kind = target === 'text' ? 'text' : 'color';
    const linked = sync.styles.find(s => s.kind === kind && s.id === nodes[0][key] && nodes.every(n => n[key] === s.id));
    const section = document.createElement('section'); section.className = 'style-control';
    const label = document.createElement('span'); label.textContent = target === 'text' ? 'Typography' : target === 'fill' ? 'Fill' : 'Stroke'; section.append(label);
    const apply = (style: Style) => { store.begin(); for (const n of nodes) if (target !== 'text' || isTextNode(n)) store.set(n.id, styleValues(style, target)); store.end(); };
    const select = document.createElement('select'); select.setAttribute('aria-label', label.textContent + ' style'); select.append(new Option('Choose style', '')); for (const s of sync.styles.filter(s => s.kind === kind)) select.append(new Option(s.name, s.id)); select.value = linked?.id ?? ''; select.onchange = () => { const s = sync.styles.find(s => s.id === select.value); select.blur(); if (s) apply(s); }; section.append(select);
    section.append(button('+', () => apply(create(sync, kind, nodes[0], target))));
    if (linked) section.append(button('Detach', () => { store.begin(); for (const n of nodes) store.set(n.id, { [key]: null }); store.end(); }));
    parent.append(section); return !!linked;
}
