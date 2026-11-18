export function responsivePanels(readOnly: boolean) {
    const header = document.querySelector('header')!;
    const more = document.createElement('details'); more.className = 'more-menu';
    const summary = document.createElement('summary'); summary.textContent = 'More';
    const options = document.createElement('div'); more.append(summary, options);
    header.querySelectorAll(':scope > label').forEach(label => options.append(label));
    header.append(more);
    if (!readOnly) {
        const panels = [...document.querySelectorAll<HTMLElement>('main > aside')];
        for (const panel of panels) {
            const button = document.createElement('button'); button.className = 'feature-button panel-toggle';
            button.textContent = panel.classList.contains('layers') ? 'Layers' : 'Inspector';
            button.setAttribute('aria-expanded', 'false');
            button.onclick = () => {
                const open = !panel.classList.contains('panel-open');
                panels.forEach(p => p.classList.remove('panel-open'));
                header.querySelectorAll('.panel-toggle').forEach(b => b.setAttribute('aria-expanded', 'false'));
                panel.classList.toggle('panel-open', open); button.setAttribute('aria-expanded', String(open));
            };
            header.append(button);
        }
    }
    new ResizeObserver(() => document.documentElement.style.setProperty('--header-height', header.offsetHeight + 'px')).observe(header);
}
