import type { Store } from '../store';
import type { Node, Key } from '../../shared/doc';
export function inspector(el: HTMLElement, store: Store) {
    el.innerHTML = '<div class="panel-heading">Design <span>Properties</span></div><div id="properties"></div><div class="panel-foot"><span>BUILT FOR TOGETHER</span><p>A little space for your next big thing.</p></div>';
    const content = el.querySelector<HTMLElement>('#properties')!;
    const render = () => {
        if (el.contains(document.activeElement))
            return;
        const nodes = [...store.selection].map(id => store.doc.get(id)).filter((n): n is Node => !!n);
        if (!nodes.length) {
            content.innerHTML = '<section><div class="section-label">PAGE</div><div class="page-color"><i></i><span>F4F3EF</span><span>100%</span></div></section><section class="welcome"><span class="eyebrow">A BLANK CANVAS.</span><h2>Make room<br>for an idea.</h2><p>Draw a frame. Add a shape.<br>Invite someone in.</p><div class="shortcut-list"><span>Move / select</span><kbd>V</kbd><span>Frame</span><kbd>F</kbd><span>Rectangle</span><kbd>R</kbd><span>Ellipse</span><kbd>O</kbd><span>Pan canvas</span><kbd>Space</kbd></div></section>';
            return;
        }
        content.innerHTML = '';
        const head = document.createElement('section');
        head.innerHTML = `<div class="section-label">${nodes.length > 1 ? nodes.length + ' OBJECTS' : nodes[0].type.toUpperCase()}</div>`;
        const name = document.createElement('input');
        name.className = 'name-input';
        name.value = nodes.length === 1 ? nodes[0].name : 'Multiple selection';
        name.setAttribute('aria-label', 'Object name');
        name.onchange = () => { store.begin(); for (const n of nodes)
            store.set(n.id, { name: name.value }); store.end(); };
        head.append(name);
        content.append(head);
        const fields = (title: string, keys: Key[]) => { const section = document.createElement('section'); section.innerHTML = `<div class="section-label">${title}</div><div class="field-grid"></div>`; const grid = section.querySelector('.field-grid')!; for (const key of keys) {
            const label = document.createElement('label');
            label.className = 'field';
            const span = document.createElement('span');
            span.textContent = ({ strokeWidth: 'Weight', radius: 'Radius', opacity: 'Opacity' } as Record<string, string>)[key] ?? key.toUpperCase();
            const input = document.createElement('input');
            input.setAttribute('aria-label', key);
            const mixed = nodes.some(n => n[key] !== nodes[0][key]);
            input.placeholder = mixed ? 'Mixed' : '';
            if (key === 'fill' || key === 'stroke') {
                input.type = 'color';
                input.value = String(nodes[0][key] ?? '#000000');
            }
            else {
                input.type = 'number';
                input.step = key === 'opacity' ? '.05' : '1';
                input.value = mixed ? '' : String(Math.round(Number(nodes[0][key]) * 100) / 100);
            }
            input.onfocus = () => store.begin();
            input.oninput = () => { const value = input.type === 'color' ? input.value : Number(input.value); for (const n of nodes)
                store.set(n.id, { [key]: value }); };
            input.onblur = () => { store.end(); render(); };
            label.append(span, input);
            grid.append(label);
        } content.append(section); };
        fields('LAYOUT', ['x', 'y', 'w', 'h']);
        fields('APPEARANCE', ['radius', 'opacity']);
        fields('FILL & STROKE', ['fill', 'stroke', 'strokeWidth']);
    };
    store.addEventListener('change', render);
    render();
}
