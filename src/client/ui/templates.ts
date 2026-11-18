import './templates.css';
import { builtInTemplates, type Template } from '../../shared/templates';
import { allTemplates, deleteTemplate, insertTemplate, saveTemplate, selectionTemplate } from '../templates';
import { exportSVG } from '../export';
import { nodeFills } from '../../shared/doc';
import { assetURL } from '../assets';
import { registerCommand } from './palette';
import type { Store } from '../store';
import type { Viewport } from '../viewport';
import type { Renderer } from '../renderer';
import type { Sync } from '../sync';

export function templateGrid(templates: Template[], choose: (template: Template) => void, remove?: (id: string) => void) {
    const grid = document.createElement('div'); grid.className = 'template-grid';
    for (const template of templates) {
        const item = document.createElement('div'); item.className = 'template-item';
        const button = document.createElement('button'); button.className = 'template-choice'; button.setAttribute('aria-label', 'Insert template: ' + template.name);
        const field = document.createElement('span'); field.className = 'template-preview';
        const img = document.createElement('img'); img.alt = '';
        const images = new Map(template.nodes.flatMap(n => nodeFills(n).flatMap(p => p.type === 'image' && template.file ? [[p.asset, assetURL(template.file, p.asset)] as const] : [])));
        const preview = () => { img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(exportSVG(new Map(template.nodes.map(n => [n.id, n])), [template.nodes[0].id], images)); };
        preview();
        if (images.size) void Promise.all([...images].map(async ([hash, url]) => {
            const response = await fetch(url); if (!response.ok) throw Error('Preview asset unavailable');
            const blob = await response.blob();
            const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
            images.set(hash, data);
        })).then(preview).catch(() => { img.alt = 'Preview unavailable'; });
        field.append(img);
        const name = document.createElement('span'); name.className = 'template-name'; name.textContent = template.name;
        const size = document.createElement('span'); size.className = 'template-size'; size.textContent = `${Math.round(template.w)} × ${Math.round(template.h)}`;
        button.append(field, name, size); button.onclick = () => choose(template); item.append(button);
        if (remove && template.category === 'Yours') { const del = document.createElement('button'); del.className = 'template-delete'; del.textContent = 'Delete'; del.setAttribute('aria-label', 'Delete template: ' + template.name); del.onclick = () => remove(template.id); item.append(del); }
        grid.append(item);
    }
    return grid;
}

export function homeTemplates() {
    const section = document.createElement('section'); section.className = 'home-templates';
    const heading = document.createElement('h2'); heading.textContent = 'Start from a template'; section.append(heading);
    section.append(templateGrid(builtInTemplates, t => location.assign(`/f/${crypto.randomUUID()}?template=${encodeURIComponent(t.id)}`)));
    return section;
}

export function installTemplates(store: Store, viewport: Viewport, renderer: Renderer, sync: Sync, file: string) {
    const dialog = document.createElement('dialog'); dialog.className = 'templates-dialog'; dialog.setAttribute('aria-label', 'Templates');
    dialog.innerHTML = '<div class="templates-heading"><h1>Templates</h1><button class="template-save">Save selection as template</button><button class="template-close" aria-label="Close templates">Close ×</button></div><p class="templates-intro">A starting point, not a blank page. Every layer is yours to edit.</p><p class="template-error" role="alert"></p><div class="template-categories"></div>';
    document.body.append(dialog);
    const error = (e: unknown) => { dialog.querySelector('.template-error')!.textContent = e instanceof Error ? e.message : 'Unable to use this template.'; };
    const insert = async (t: Template, initial = false) => { try { await insertTemplate(t, store, viewport, renderer, file, initial); dialog.close(); renderer.canvas.focus(); } catch (e) { if (!dialog.open) dialog.showModal(); error(e); } };
    let removeCommands: (() => void)[] = [];
    function updateCommands() {
        removeCommands.forEach(remove => remove());
        removeCommands = allTemplates().map(t => registerCommand({ id: 'template-' + t.id, title: 'Insert template: ' + t.name, group: 'Edit', run: () => insert(t), enabled: () => !store.readOnly }));
    }
    function render() {
        updateCommands();
        const container = dialog.querySelector('.template-categories')!; container.replaceChildren();
        const templates = allTemplates();
        for (const category of ['Digital', 'Editorial', 'Print', 'Yours']) {
            const heading = document.createElement('h2'); heading.textContent = category; container.append(heading);
            const items = templates.filter(t => t.category === category);
            if (items.length) container.append(templateGrid(items, t => void insert(t), id => { try { deleteTemplate(id); render(); } catch (e) { error(e); } }));
            else { const empty = document.createElement('p'); empty.textContent = 'Select layers on the canvas, then save them here.'; container.append(empty); }
        }
        (dialog.querySelector('.template-save') as HTMLButtonElement).disabled = !store.selection.size || store.readOnly;
    }
    function open() { if (store.readOnly) return; dialog.querySelector('.template-error')!.textContent = ''; render(); dialog.showModal(); }
    function save() { try { saveTemplate(selectionTemplate(store.doc, store.selection, file)); if (!dialog.open) dialog.showModal(); render(); } catch (e) { if (!dialog.open) dialog.showModal(); error(e); } }
    (dialog.querySelector('.template-close') as HTMLButtonElement).onclick = () => dialog.close();
    (dialog.querySelector('.template-save') as HTMLButtonElement).onclick = save;
    dialog.addEventListener('click', e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close(); } });
    const button = document.createElement('button'); button.textContent = 'Templates'; button.className = 'templates-trigger'; button.onclick = open; button.hidden = store.readOnly;
    document.querySelector('header')!.append(button);
    registerCommand({ id: 'templates', title: 'Open Templates gallery', group: 'Edit', run: open, enabled: () => !store.readOnly });
    registerCommand({ id: 'save-template', title: 'Save selection as template', group: 'Edit', run: save, enabled: () => !store.readOnly && store.selection.size > 0 });
    updateCommands();
    window.addEventListener('storage', updateCommands);
    let inserting = false;
    const initial = async () => {
        if (!sync.ready || inserting || store.readOnly) return;
        const url = new URL(location.href), id = url.searchParams.get('template'); if (!id) return;
        inserting = true;
        url.searchParams.delete('template'); history.replaceState(null, '', url);
        const template = builtInTemplates.find(t => t.id === id);
        if (template && ![...store.pageDoc.values()].some(n => n.type !== 'page')) await insert(template, true);
    };
    sync.addEventListener('change', () => void initial()); void initial();
}
