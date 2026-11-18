import type { Sync } from '../sync';
import type { Renderer } from '../renderer';
export function historyPanel(sync: Sync, renderer: Renderer) {
    const panel = document.createElement('div'); panel.className = 'feature-panel'; panel.hidden = true;
    const banner = document.createElement('div'); banner.className = 'preview-banner'; banner.hidden = true;
    document.body.append(panel, banner);
    const inspector = document.querySelector('aside')!, unavailable = document.createElement('section');
    unavailable.className = 'preview-inspector'; unavailable.textContent = 'Inspector unavailable while previewing'; unavailable.hidden = true; inspector.append(unavailable);
    function previewInspector(active: boolean) { inspector.classList.toggle('previewing', active); unavailable.hidden = !active; }
    let previewId = '', requested = '';
    function current() { previewId = ''; requested = ''; renderer.preview = null; renderer.canvas.style.pointerEvents = ''; previewInspector(false); banner.hidden = true; renderer.invalidate(); render(); renderer.canvas.focus(); }
    function render() {
        const value = panel.querySelector('input')?.value ?? '', focused = document.activeElement === panel.querySelector('input');
        panel.replaceChildren();
        const head = document.createElement('section'); head.innerHTML = '<h2>Version history</h2><input aria-label="Version name" placeholder="Name this version"><button class="feature-button">Save version</button>';
        head.querySelector('button')!.onclick = () => { sync.send({ type: 'version-save', name: head.querySelector('input')!.value || 'Saved version' }); };
        panel.append(head);
        head.querySelector('input')!.onkeydown = e => e.stopPropagation();
        head.querySelector('input')!.value = value;
        if (focused) head.querySelector('input')!.focus();
        if (!sync.versions.length) { const empty = document.createElement('section'); empty.textContent = 'No versions yet. Save a milestone to return to it later.'; panel.append(empty); }
        for (const v of [...sync.versions].reverse()) {
            const row = document.createElement('button'); row.className = 'version-row' + (previewId === v.id ? ' active' : '');
            const name = document.createElement('span'); name.textContent = v.name;
            const meta = document.createElement('small'); meta.textContent = `${new Date(v.at).toLocaleString()} · ${v.author} · ${v.nodeCount} objects`;
            row.append(name, meta); row.onclick = () => { requested = v.id; sync.send({ type: 'version-preview', id: v.id }); }; panel.append(row);
        }
    }
    sync.addEventListener('preview', event => {
        const m = (event as CustomEvent).detail; if (m.id !== requested || panel.hidden) return;
        previewId = m.id; renderer.preview = new Map(m.nodes.map((n: import('../../shared/doc').Node) => [n.id, n]));
        renderer.canvas.style.pointerEvents = 'none'; previewInspector(true); renderer.invalidate();
        banner.replaceChildren(); const text = document.createElement('span'); text.textContent = 'Viewing ' + (sync.versions.find(v => v.id === m.id)?.name ?? 'version');
        const restore = document.createElement('button'); restore.className = 'feature-button'; restore.textContent = 'Restore'; restore.onclick = () => { if (confirm('Restore this version for everyone? Current work will be saved first.')) sync.send({ type: 'version-restore', id: previewId }); };
        const back = document.createElement('button'); back.className = 'feature-button'; back.textContent = 'Back to current'; back.onclick = current;
        banner.append(text, restore, back); banner.hidden = false; render(); restore.focus();
    });
    sync.addEventListener('change', () => { if (!panel.contains(document.activeElement)) render(); }); sync.addEventListener('restored', current);
    sync.addEventListener('versions-change', render);
    window.addEventListener('keydown', e => {
        if (!renderer.preview || (e.target as HTMLElement).matches('input,textarea')) return;
        if (e.key === 'Tab') return;
        if (banner.contains(e.target as HTMLElement) && ['Enter', ' '].includes(e.key)) { e.stopImmediatePropagation(); return; }
        e.preventDefault(); e.stopImmediatePropagation(); if (e.key === 'Escape') current();
    }, true);
    return () => { panel.hidden = !panel.hidden; if (panel.hidden) current(); else render(); };
}
