import { children, type Node } from '../../shared/doc';
import { moveOps } from '../../shared/layers';
import { ancestorMasks } from '../../shared/geometry';
import type { Context } from '../tools/tool';
import { sizeOf } from '../geometry';
const paths: Record<string, string> = { frame: '<path d="M5 1v14M11 1v14M1 5h14M1 11h14"/>', rect: '<rect x="2" y="3" width="12" height="10"/>', ellipse: '<ellipse cx="8" cy="8" rx="6" ry="5"/>', group: '<path stroke-dasharray="2 2" d="M2 2h12v12H2z"/>', eye: '<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5Z"/><circle cx="8" cy="8" r="2"/>', lock: '<rect x="3" y="7" width="10" height="7"/><path d="M5 7V4a3 3 0 0 1 6 0v3"/>', disclosure: '<path d="m6 3 5 5-5 5"/>' };
paths.text = '<path d="M2 3h12M8 3v11M5 14h6"/>';
paths.mask = '<circle cx="8" cy="8" r="6"/><path d="M8 2v12M8 5h4M8 8h6M8 11h4"/>';
paths.path = '<path d="M2 13C2 2 14 14 14 3"/><rect x="1" y="12" width="2" height="2"/><rect x="13" y="2" width="2" height="2"/>';
const icon = (name: string) => '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">' + paths[name] + '</svg>';
export function layers(el: HTMLElement, ctx: Context) {
    const { store } = ctx, collapsed = new Set<string>(); let dragging = '', editing: string | undefined, lastName = '', lastTime = 0;
    let previous = '';
    const render = () => {
        if (editing && store.doc.has(editing)) return;
        const selection = [...store.selection].join(',');
        if (selection !== previous) for (const id of store.selection) { let p = store.doc.get(id)?.parent; while (p) { collapsed.delete(p); p = store.doc.get(p)?.parent; } }
        previous = selection;
        el.replaceChildren(); const heading = document.createElement('div'); heading.className = 'layers-heading'; heading.textContent = 'Layers'; el.append(heading);
        const tree = document.createElement('div'); tree.className = 'layers-tree'; el.append(tree);
        const visit = (parent: string | null, depth: number) => { for (const n of children(store.doc, parent).reverse()) {
            const row = document.createElement('div'); row.className = 'layer-row'; row.dataset.id = n.id; row.draggable = true; row.style.paddingLeft = 6 + depth * 14 + 'px'; row.classList.toggle('selected', store.selection.has(n.id)); row.classList.toggle('hidden', !!n.hidden);
            const container = n.type === 'frame' || n.type === 'group';
            const disclosure = document.createElement('button'); disclosure.className = 'layer-disclosure'; disclosure.innerHTML = container ? icon('disclosure') : ''; disclosure.style.transform = container && !collapsed.has(n.id) ? 'rotate(90deg)' : ''; disclosure.setAttribute('aria-label', collapsed.has(n.id) ? 'Expand' : 'Collapse');
            disclosure.onclick = e => { e.stopPropagation(); if (collapsed.has(n.id)) collapsed.delete(n.id); else collapsed.add(n.id); render(); }; row.append(disclosure);
            if (ancestorMasks(store.doc, n).length) row.style.borderLeft = '1px solid #d6d4ce';
            const glyph = document.createElement('span'); glyph.className = 'layer-glyph'; glyph.innerHTML = icon(n.mask ? 'mask' : n.type); row.append(glyph);
            const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = n.name; row.append(name);
            name.onclick = e => { const double = lastName === n.id && e.timeStamp - lastTime < 400; lastName = n.id; lastTime = e.timeStamp; if (!double) return; e.stopPropagation(); editing = n.id; row.draggable = false; const input = document.createElement('input'); input.value = n.name; input.setAttribute('aria-label', 'Layer name'); name.replaceWith(input); input.focus(); input.select(); let done = false;
                const finish = (save: boolean) => { if (done) return; done = true; editing = undefined; if (save && input.value.trim()) store.set(n.id, { name: input.value.trim() }); render(); };
                input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }; input.onblur = () => finish(true);
            };
            for (const [key, glyph] of [['hidden', 'eye'], ['locked', 'lock']] as const) { const b = document.createElement('button'); b.className = 'layer-toggle'; b.classList.toggle('on', !!n[key]); b.innerHTML = icon(glyph); b.title = key === 'hidden' ? 'Toggle visibility' : 'Toggle lock'; b.setAttribute('aria-label', b.title); b.setAttribute('aria-pressed', String(!!n[key])); b.onclick = e => { e.stopPropagation(); store.set(n.id, { [key]: !n[key] }); }; row.append(b); }
            row.onclick = e => { if ((e.target as HTMLElement).closest('input')) return; if (e.shiftKey || e.ctrlKey || e.metaKey) { if (store.selection.has(n.id)) store.selection.delete(n.id); else store.selection.add(n.id); } else { store.selection.clear(); store.selection.add(n.id); } store.changed(); };
            row.onmouseenter = () => { ctx.hover = n.id; ctx.invalidate(); }; row.onmouseleave = () => { ctx.hover = undefined; ctx.invalidate(); };
            const zone = (e: DragEvent) => { const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height; return y < .25 ? 'above' : y > .75 || !container ? 'below' : 'into'; };
            row.ondragstart = e => { dragging = n.id; e.dataTransfer!.setData('text/plain', n.id); e.dataTransfer!.effectAllowed = 'move'; };
            row.ondragover = e => { e.preventDefault(); row.dataset.drop = zone(e); }; row.ondragleave = () => { delete row.dataset.drop; };
            row.ondrop = e => { e.preventDefault(); const z = zone(e); delete row.dataset.drop; if (!dragging || dragging === n.id) return; const ops = moveOps(store.doc, dragging, z === 'into' ? n.id : n.parent, z === 'into' ? {} : z === 'above' ? { afterId: n.id } : { beforeId: n.id }, sizeOf); store.begin(); store.commit(ops); store.end(); dragging = ''; };
            row.ondragend = () => { dragging = ''; for (const r of tree.querySelectorAll<HTMLElement>('[data-drop]')) delete r.dataset.drop; };
            tree.append(row); if (container && !collapsed.has(n.id)) visit(n.id, depth + 1);
        } }; visit(null, 0);
    };
    store.addEventListener('restore', () => { dragging = ''; });
    store.addEventListener('change', render); render();
}
