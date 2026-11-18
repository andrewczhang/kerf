const keys: [string, string][] = [
    ['Move / select', 'V'], ['Frame', 'F'], ['Rectangle', 'R'], ['Ellipse', 'O'], ['Text', 'T'], ['Pen', 'P'], ['Hand', 'H'],
    ['Draw', 'Drag'], ['Pan canvas', 'Space'], ['Zoom', 'Ctrl Scroll'], ['Edit text or points', 'Enter'],
    ['Undo', 'Ctrl Z'], ['Redo', 'Ctrl ⇧ Z'], ['Copy', 'Ctrl C'], ['Paste', 'Ctrl V'], ['Duplicate', 'Ctrl D'],
    ['Group', 'Ctrl G'], ['Use as mask', 'Ctrl Alt M'], ['Ungroup', 'Ctrl ⇧ G'], ['Delete', 'Del'], ['Nudge', 'Arrows'], ['Add to selection', '⇧ Click'], ['Duplicate while moving', 'Alt Drag'],
    ['Comment', 'C'], ['Rulers', '⇧ R'], ['Export PNG 2x', 'Ctrl ⇧ E'], ['Shortcuts', '?']
];
export const shortcutList = (limit = keys.length) => `<div class="shortcut-list">${keys.slice(0, limit).map(([what, key]) => `<span>${what}</span><kbd>${key}</kbd>`).join('')}</div>`;
export function shortcutsPanel(header: HTMLElement) {
    const panel = document.createElement('div');
    panel.className = 'feature-panel shortcuts-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Keyboard shortcuts');
    panel.innerHTML = `<section><h2>Keyboard shortcuts</h2></section><div>${shortcutList()}</div>`;
    document.querySelector('.canvas-wrap')!.append(panel);
    const toggle = (open = panel.hidden) => { panel.hidden = !open; header.querySelector('.shortcuts-button')?.classList.toggle('active', open); };
    window.addEventListener('keydown', e => {
        if ((e.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return;
        if (e.key === '?') { e.preventDefault(); toggle(); }
        else if (e.key === 'Escape' && !panel.hidden) toggle(false);
    });
    return () => toggle();
}
