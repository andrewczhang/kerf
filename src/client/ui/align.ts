import { eligible, type Alignment } from '../../shared/align';
import { applyAlignment } from '../align';
import type { Store } from '../store';

export function alignSection(content: HTMLElement, store: Store) {
    const count = eligible(store.doc, store.selection).length;
    if (!count) return;
    const section = document.createElement('section');
    section.innerHTML = '<div style="margin-bottom:12px">Align</div>';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:2px';
    const actions: [Alignment, string, string, string][] = [
        ['left', 'Align left', 'Alt+A', 'M4 3v18M7 7h12v4H7zM7 14h8v4H7z'],
        ['hcenter', 'Align horizontal center', 'Alt+H', 'M12 3v18M4 7h16v4H4zM7 14h10v4H7z'],
        ['right', 'Align right', 'Alt+D', 'M20 3v18M5 7h12v4H5zM9 14h8v4H9z'],
        ['top', 'Align top', 'Alt+W', 'M3 4h18M7 7h4v12H7zM14 7h4v8h-4z'],
        ['vmiddle', 'Align vertical middle', 'Alt+V', 'M3 12h18M7 4h4v16H7zM14 7h4v10h-4z'],
        ['bottom', 'Align bottom', 'Alt+S', 'M3 20h18M7 5h4v12H7zM14 9h4v8h-4z'],
        ['horizontal', 'Distribute horizontal spacing', 'Alt+Shift+H', 'M3 4v16M21 4v16M7 7h3v10H7zM14 7h3v10h-3z'],
        ['vertical', 'Distribute vertical spacing', 'Alt+Shift+V', 'M4 3h16M4 21h16M7 7h10v3H7zM7 14h10v3H7z'],
        ['tidy', 'Tidy up', 'Ctrl+Alt+T', 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
    ];
    for (const [action, title, shortcut, path] of actions) {
        const button = document.createElement('button');
        button.title = `${title} (${shortcut})`;
        button.setAttribute('aria-label', button.title);
        button.style.cssText = 'width:30px;height:30px;padding:5px;border-radius:0';
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="${path}"/></svg>`;
        button.disabled = count < (action === 'tidy' ? 2 : action === 'horizontal' || action === 'vertical' ? 3 : 1);
        if (button.disabled) button.style.opacity = '.3';
        button.onclick = () => { button.blur(); applyAlignment(store, action); };
        row.append(button);
    }
    section.append(row);
    content.append(section);
}
