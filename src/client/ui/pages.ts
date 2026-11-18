import { addPage, deletePageOps, moveToPageOps, pages as pageList, reorderPageOps } from '../../shared/pages';
import type { Node, Op } from '../../shared/doc';
import type { Store } from '../store';
import type { Sync } from '../sync';
import { sizeOf } from '../geometry';

export function pages(el: HTMLElement, store: Store, sync?: Sync) {
    let editing: string | undefined, last = '', time = 0, peers = '';
    const commit = (ops: Op[]) => { if (!ops.length) return; store.begin(); store.commit(ops); store.end(); };
    const remove = (id: string) => commit(deletePageOps(store.doc, id));
    function rename(name: HTMLElement, n: Node) {
        editing = n.id; const input = document.createElement('input'); input.value = n.name; input.setAttribute('aria-label', 'Page name'); name.replaceWith(input); input.focus(); input.select(); let done = false;
        const finish = (save: boolean) => { if (done) return; done = true; editing = undefined; if (save && input.value.trim()) store.set(n.id, { name: input.value.trim() }); render(); };
        input.onclick = e => e.stopPropagation(); input.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }; input.onblur = () => finish(true);
    }
    function render() {
        if (editing && store.doc.has(editing)) return;
        const active = document.activeElement as HTMLElement | null, focused = active && el.contains(active) ? active.closest<HTMLElement>('[data-page]')?.dataset.page : undefined;
        el.replaceChildren(); const heading = document.createElement('div'); heading.className = 'layers-heading'; heading.textContent = 'Pages';
        const add = document.createElement('button'); add.textContent = '+'; add.title = 'Add page'; add.setAttribute('aria-label', 'Add page');
        add.onclick = () => { const node = addPage(store.doc); commit([{ t: 'create', node }]); store.setPage(node.id); }; heading.append(add); el.append(heading);
        const list = pageList(store.doc);
        for (const n of list) {
            const row = document.createElement('div'); row.className = 'page-row'; row.dataset.page = n.id; row.tabIndex = 0; row.draggable = true; row.classList.toggle('selected', n.id === store.currentPage); row.setAttribute('aria-current', String(n.id === store.currentPage));
            const name = document.createElement('span'); name.className = 'page-name'; name.textContent = n.name; row.append(name);
            name.onclick = e => { const double = last === n.id && e.timeStamp - time < 400; last = n.id; time = e.timeStamp; if (double) { e.stopPropagation(); rename(name, n); } };
            row.onclick = () => { store.setPage(n.id); [...el.querySelectorAll<HTMLElement>('[data-page]')].find(r => r.dataset.page === n.id)?.focus(); };
            row.onkeydown = e => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); remove(n.id); } else if (e.key === 'Enter') { e.preventDefault(); store.setPage(n.id); } else if (e.key === 'F2') { e.preventDefault(); rename(name, n); } };
            for (const peer of sync?.peers.values() ?? []) if ((peer.page ?? list[0]?.id) === n.id) { const avatar = document.createElement('span'); avatar.className = 'page-peer'; avatar.textContent = peer.name.slice(0, 1); avatar.style.background = peer.color; avatar.title = peer.name; row.append(avatar); }
            row.oncontextmenu = e => { e.preventDefault(); el.querySelector('.page-menu')?.remove(); const menu = document.createElement('div'), del = document.createElement('button'); menu.className = 'page-menu'; del.textContent = 'Delete page'; del.disabled = list.length <= 1; del.onclick = e => { e.stopPropagation(); remove(n.id); }; menu.append(del); row.append(menu); del.focus(); del.onblur = () => menu.remove(); };
            row.ondragstart = e => { e.dataTransfer!.setData('application/x-kerf-page', n.id); e.dataTransfer!.effectAllowed = 'move'; };
            row.ondragover = e => { e.preventDefault(); row.dataset.drop = e.dataTransfer?.types.includes('application/x-kerf-page') ? e.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2 ? 'above' : 'below' : 'into'; };
            row.ondragleave = () => { delete row.dataset.drop; };
            row.ondrop = e => { e.preventDefault(); e.stopPropagation(); const page = e.dataTransfer?.getData('application/x-kerf-page'), layer = e.dataTransfer?.getData('application/x-kerf-layer'); const after = row.dataset.drop === 'below'; delete row.dataset.drop; if (page) commit(reorderPageOps(store.doc, page, n.id, after)); else if (layer) commit(moveToPageOps(store.doc, layer, n.id, sizeOf)); };
            row.ondragend = () => { for (const r of el.querySelectorAll<HTMLElement>('[data-drop]')) delete r.dataset.drop; };
            el.append(row);
        }
        if (focused) [...el.querySelectorAll<HTMLElement>('[data-page]')].find(r => r.dataset.page === (store.doc.has(focused) ? focused : store.currentPage))?.focus();
    }
    store.addEventListener('change', render); sync?.addEventListener('change', () => { const next = JSON.stringify([...(sync?.peers.values() ?? [])].map(p => [p.id, p.page, p.name, p.color])); if (next !== peers) { peers = next; render(); } }); render();
}
