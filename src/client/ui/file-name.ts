import './file-name.css';
import { recordRecent } from '../recent-files';
import { registerCommand } from './palette';
import type { Sync } from '../sync';

export function fileName(sync: Sync, canEdit: () => boolean) {
    const label = document.querySelector<HTMLElement>('.file-name')!;
    label.setAttribute('role', 'button'); label.tabIndex = 0; label.setAttribute('aria-label', 'Rename file');
    let input: HTMLInputElement | undefined;
    const available = () => sync.ready && canEdit();
    function render() {
        const name = sync.name || 'Untitled';
        document.title = name + ' — Kerf';
        if (!input) label.textContent = name;
        label.setAttribute('aria-disabled', String(!available()));
    }
    function update() { recordRecent({ id: sync.file, name: sync.name || 'Untitled' }); render(); }
    function rename() {
        if (!available() || input) return;
        input = document.createElement('input'); input.className = 'file-name-input'; input.setAttribute('aria-label', 'File name'); input.value = sync.name;
        const field = input;
        function finish(commit: boolean) {
            if (input !== field) return;
            input = undefined;
            if (commit && available() && field.value !== sync.name) sync.send({ type: 'rename', name: field.value });
            field.remove(); label.hidden = false; render();
        }
        field.onkeydown = e => {
            e.stopPropagation();
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); finish(e.key === 'Enter'); label.focus(); }
        };
        field.onblur = () => finish(true);
        label.hidden = true; label.after(field); field.focus(); field.select();
    }
    label.onclick = rename;
    label.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); rename(); } };
    sync.addEventListener('name-change', update);
    sync.addEventListener('change', render);
    registerCommand({ id: 'rename-file', title: 'Rename file', group: 'File', run: rename, enabled: available });
    render();
}
