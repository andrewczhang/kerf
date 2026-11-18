import type { Sync } from '../sync';
import type { Store } from '../store';

export function sharing(header: HTMLElement, sync: Sync, store: Store) {
    const controls = document.createElement('div'); controls.className = 'share-controls';
    const status = document.createElement('span'); status.setAttribute('role', 'status');
    const manual = document.createElement('input'); manual.readOnly = true; manual.hidden = true; manual.setAttribute('aria-label', 'Link to copy manually');
    const copy = async (url: string) => {
        manual.hidden = true;
        try { await navigator.clipboard.writeText(url); status.textContent = 'Link copied'; }
        catch { status.textContent = 'Copy this link:'; manual.value = url; manual.hidden = false; manual.focus(); manual.select(); }
    };
    const viewUrl = (key: string) => {
        const url = new URL('/v/' + key, location.origin);
        const frame = [...store.selection].map(id => store.doc.get(id)).find(n => n?.type === 'frame' && !n.parent);
        if (frame) url.searchParams.set('present', frame.id);
        return url.href;
    };
    const button = (label: string, action: () => void) => { const b = document.createElement('button'); b.className = 'feature-button'; b.textContent = label; b.onclick = action; controls.append(b); };
    if (sync.role === 'edit') {
        button('Copy edit link', () => { void copy(new URL('/f/' + sync.file, location.origin).href); });
        button('Copy view link', () => { if (!sync.send({ type: 'share-view' })) status.textContent = 'Reconnect to create a view link.'; });
        sync.addEventListener('share-view', e => { void copy(viewUrl((e as CustomEvent<string>).detail)); });
    } else {
        const label = document.createElement('span'); label.textContent = 'View only'; controls.append(label);
        button('Copy view link', () => { void copy(viewUrl(sync.file)); });
    }
    controls.append(status, manual); header.append(controls);
}
