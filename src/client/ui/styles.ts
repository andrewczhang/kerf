import type { Sync } from '../sync';
import type { Store } from '../store';
import { isTextNode, maxFontSize, nodeFills, textFonts, textWeights, type Key, type Node } from '../../shared/doc';
import { expand, isVirtual, splitVirtual } from '../../shared/components';
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
        for (let style of styles) {
            const row = document.createElement('button'); row.className = 'style-row';
            const sample = document.createElement('span'); sample.className = 'style-sample';
            const label = document.createElement('span'), name = document.createElement('span'), spec = document.createElement('small');
            const count = [...store.doc.values()].filter(n => n.fillStyle === style.id || n.strokeStyle === style.id || n.textStyle === style.id).length;
            const refresh = (value: Style) => {
                style = value;
                name.textContent = style.name;
                if (style.kind === 'color') sample.style.backgroundColor = style.color;
                else { sample.textContent = 'Ag'; sample.style.fontFamily = fonts[style.fontFamily]; sample.style.fontWeight = String(style.fontWeight); }
                spec.textContent = (style.kind === 'color' ? style.color : `${style.fontFamily} ${style.fontSize} · ${style.fontWeight}`) + ` · ${count} layers`;
            };
            refresh(style);
            label.append(name, spec); row.append(sample, label); section.append(row);
            row.onclick = () => {
                if (row.nextElementSibling?.classList.contains('style-editor')) { row.nextElementSibling.remove(); return; }
                const editor = document.createElement('div'); editor.className = 'style-editor'; row.after(editor); let draft = { ...style }; let timer: ReturnType<typeof setTimeout>;
                const update = (key: string, value: string | number) => { draft = { ...draft, [key]: value }; if (validStyle(draft)) refresh(draft); };
                const send = () => { if (validStyle(draft)) sync.send({ type: 'style-upsert', style: draft }); };
                const input = (key: string, type: string, value: string) => { const label = document.createElement('label'); label.textContent = key === 'fontSize' ? 'Size' : key === 'fontFamily' ? 'Font' : key === 'fontWeight' ? 'Weight' : key; const field = document.createElement('input'); field.type = type; field.value = value; field.setAttribute('aria-label', 'Style ' + key); if (key === 'fontSize') { field.min = '1'; field.max = String(maxFontSize); } field.oninput = () => { update(key, type === 'number' ? Number(field.value) : field.value); clearTimeout(timer); if (type === 'color') send(); else timer = setTimeout(send, 250); }; field.onchange = () => { clearTimeout(timer); send(); }; label.append(field); editor.append(label); };
                input('name', 'text', style.name);
                if (style.kind === 'color') input('color', 'color', style.color);
                else {
                    for (const [key, values] of [['fontFamily', textFonts], ['fontWeight', textWeights]] as const) { const label = document.createElement('label'); label.textContent = key === 'fontFamily' ? 'Font' : 'Weight'; const select = document.createElement('select'); select.setAttribute('aria-label', 'Style ' + key); for (const value of values) select.append(new Option(String(value), String(value))); select.value = String(style[key]); select.onchange = () => { update(key, key === 'fontWeight' ? Number(select.value) : select.value); send(); }; label.append(select); editor.append(label); }
                    input('fontSize', 'number', String(style.fontSize));
                }
                editor.append(button('Delete style', () => { clearTimeout(timer); sync.send({ type: 'style-delete', id: style.id }); editor.remove(); }));
            };
        }
    }
}
export function styleControl(parent: HTMLElement, store: Store, sync: Sync, nodes: Node[], target: 'fill' | 'stroke' | 'text'): boolean {
    const write = (node: Node, values: Partial<Record<Key, unknown>>) => {
        const virtual = isVirtual(node.id), { instance, target } = splitVirtual(node.id);
        if (virtual || node.instanceOf) store.commit(Object.entries(values).map(([key, value]) => ({ t: 'override', id: virtual ? instance : node.id, target: virtual ? target : '', key: key as Key, value })));
        else store.set(node.id, values);
    };
    const key = target === 'fill' ? 'fillStyle' : target === 'stroke' ? 'strokeStyle' : 'textStyle', kind = target === 'text' ? 'text' : 'color';
    const linked = sync.styles.find(s => s.kind === kind && s.id === nodes[0][key] && nodes.every(n => n[key] === s.id));
    const apply = (style: Style) => { store.begin(); for (const n of nodes) if (target !== 'text' || isTextNode(n)) write(n, styleValues(style, target)); store.end(); };
    const heading = parent.firstElementChild as HTMLElement; heading.classList.add('style-section-heading');
    const row = (style: Style, action: () => void) => {
        const b = button('', action); b.className = 'style-row';
        const sample = document.createElement('span'); sample.className = 'style-sample'; sample.setAttribute('aria-hidden', 'true');
        if (style.kind === 'color') sample.style.backgroundColor = style.color;
        else { sample.textContent = 'Ag'; sample.style.fontFamily = fonts[style.fontFamily]; sample.style.fontWeight = String(style.fontWeight); }
        const name = document.createElement('span'); name.className = 'style-name'; name.textContent = style.name; b.append(sample, name); return b;
    };
    let picker: HTMLElement | undefined;
    const toggle = () => {
        if (picker?.isConnected) { picker.remove(); trigger.setAttribute('aria-expanded', 'false'); return; }
        picker = document.createElement('div'); picker.className = 'style-picker'; picker.setAttribute('aria-label', 'Styles');
        for (const s of sync.styles.filter(s => s.kind === kind)) picker.append(row(s, () => apply(s)));
        if (!picker.childElementCount) { const empty = document.createElement('p'); empty.className = 'style-empty'; empty.textContent = 'No styles yet'; picker.append(empty); }
        const add = button('Create style from current', () => apply(create(sync, kind, nodes[0], target))); add.className = 'style-create'; picker.append(add);
        picker.onkeydown = e => { if (e.key === 'Escape') { e.stopPropagation(); picker?.remove(); trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); } };
        trigger.setAttribute('aria-expanded', 'true');
        (linkedRow ?? heading).after(picker);
    };
    let linkedRow: HTMLElement | undefined;
    const trigger = linked ? row(linked, toggle) : button('◇', toggle);
    trigger.onclick = toggle;
    trigger.title = 'Apply style'; trigger.setAttribute('aria-label', linked ? 'Apply style: ' + linked.name : 'Apply style'); trigger.setAttribute('aria-expanded', 'false');
    if (linked) {
        linkedRow = document.createElement('div'); linkedRow.className = 'style-linked';
        const detach = button('×', () => {
            const resolved = expand(store.doc);
            store.begin();
            for (const n of nodes) {
                const current = resolved.get(n.id) ?? n;
                const appearance = target === 'fill' ? { fill: current.fill, fills: nodeFills(current) } : target === 'stroke' ? { stroke: current.stroke } : { fontFamily: current.fontFamily, fontSize: current.fontSize, fontWeight: current.fontWeight };
                write(n, { ...appearance, [key]: null });
            }
            store.end();
        }); detach.title = 'Detach style'; detach.setAttribute('aria-label', 'Detach style');
        linkedRow.append(trigger, detach); heading.after(linkedRow);
        if (target === 'fill') heading.querySelector('button')?.remove();
    } else { trigger.className = 'style-apply'; heading.append(trigger); }
    return !!linked;
}
