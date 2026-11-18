import './palette.css';

export interface Command { id: string; title: string; group?: string; shortcut?: string; run: () => void | Promise<void>; enabled?: () => boolean }
export const commands = new Map<string, Command>();
export function registerCommand(command: Command) { commands.set(command.id, command); return () => { if (commands.get(command.id) === command) commands.delete(command.id); }; }
export function fuzzyMatch(text: string, query: string): number[] | null {
    const indices: number[] = []; let from = 0;
    for (const char of query.trim().toLowerCase()) {
        if (/\s/.test(char)) continue;
        const at = text.toLowerCase().indexOf(char, from);
        if (at < 0) return null;
        indices.push(at); from = at + 1;
    }
    return indices;
}

export function rankCommands(candidates: Iterable<Command>, query: string): Command[] {
    const ranked: { command: Command; score: number }[] = [];
    for (const command of candidates) {
        if (command.enabled && !command.enabled()) continue;
        const matches = fuzzyMatch(command.title, query);
        if (!matches) continue;
        let score = 0;
        matches.forEach((at, i) => {
            if (at === 0 || /\W/.test(command.title[at - 1])) score += 20;
            if (i > 0) score += at === matches[i - 1] + 1 ? 15 : -(at - matches[i - 1] - 1);
        });
        ranked.push({ command, score });
    }
    return ranked.sort((a, b) => b.score - a.score || a.command.title.localeCompare(b.command.title)).map(({ command }) => command);
}

export function installPalette(canvas: HTMLCanvasElement, prepare = () => {}) {
    const overlay = document.createElement('div'); overlay.className = 'palette-overlay'; overlay.hidden = true;
    overlay.innerHTML = '<div class="palette" role="dialog" aria-modal="true" aria-label="Commands"><input aria-label="Search commands" placeholder="Search commands…" autocomplete="off" role="combobox" aria-controls="command-results" aria-expanded="true"><div id="command-results" role="listbox"></div><div class="palette-help">↑ ↓ Navigate · Enter Run · Esc Close</div><div class="palette-error" role="alert"></div></div>';
    document.body.append(overlay);
    const input = overlay.querySelector('input')!, list = overlay.querySelector<HTMLElement>('#command-results')!;
    let selected = 0, results: Command[] = [];
    const close = () => { overlay.hidden = true; canvas.focus(); };
    async function run(command: Command) {
        if (command.enabled && !command.enabled()) return;
        close();
        try { await command.run(); canvas.focus(); } catch { overlay.hidden = false; overlay.querySelector('.palette-error')!.textContent = 'Command failed. Please try again.'; input.focus(); }
    }
    function render() {
        results = rankCommands(commands.values(), input.value);
        selected = Math.max(0, Math.min(selected, results.length - 1)); list.replaceChildren();
        results.forEach((command, i) => {
            const row = document.createElement('button'); row.className = 'palette-row'; row.id = 'command-' + i; row.role = 'option'; row.setAttribute('aria-selected', String(i === selected));
            const title = document.createElement('span'), matches = fuzzyMatch(command.title, input.value)!;
            [...command.title].forEach((char, at) => { const part = document.createElement(matches.includes(at) ? 'mark' : 'span'); part.textContent = char; title.append(part); });
            const group = document.createElement('small'); group.textContent = command.group ?? '';
            const hint = document.createElement('kbd'); hint.textContent = command.shortcut ?? ''; row.append(title, group, hint); row.onclick = () => void run(command); list.append(row);
        });
        if (!results.length) { list.textContent = 'No matching commands'; input.removeAttribute('aria-activedescendant'); }
        else { input.setAttribute('aria-activedescendant', 'command-' + selected); list.children[selected]?.scrollIntoView({ block: 'nearest' }); }
    }
    function open() { prepare(); overlay.hidden = false; input.value = ''; selected = 0; overlay.querySelector('.palette-error')!.textContent = ''; render(); input.focus(); }
    input.oninput = () => { selected = 0; render(); };
    overlay.onpointerdown = e => { if (e.target === overlay) close(); };
    window.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopImmediatePropagation(); if (overlay.hidden) open(); else close(); return; }
        if (overlay.hidden) return;
        e.stopImmediatePropagation();
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); selected = results.length ? (selected + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0; render(); }
        if (e.key === 'Enter') { e.preventDefault(); if (results[selected]) void run(results[selected]); }
        if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
    }, true);
    return open;
}
