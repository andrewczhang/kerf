import { children, descendants, makeNode, nodeFills, between, type Doc, type Node } from '../shared/doc';
import { expand } from '../shared/components';
import { aabb, bounds, matrixAngle, worldMatrix } from '../shared/geometry';
import { builtInTemplates, insertionOps, readTemplates, writeTemplates, type Template } from '../shared/templates';
import { copyAsset } from './assets';
import { measureTextNode } from './text-layout';
import { sizeOf } from './geometry';
import type { Store } from './store';
import type { Viewport } from './viewport';
import type { Renderer } from './renderer';

export function selectionTemplate(doc: Doc, selection: Iterable<string>, file: string): Template {
    const expanded = expand(doc, measureTextNode), ids = new Set(selection);
    const roots = [...ids].flatMap(id => { const n = expanded.get(id); return n && n.type !== 'page' && ![...ids].some(other => other !== id && descendants(expanded, other).some(c => c.id === id)) ? [n] : []; });
    if (!roots.length) throw Error('Select one or more layers first.');
    const r = bounds(roots.map(n => aabb(expanded, n, sizeOf)));
    const frame = { ...makeNode('frame', 0, 0), name: roots.length === 1 ? roots[0].name : 'Saved selection', w: Math.max(1, r.w), h: Math.max(1, r.h), fills: [] };
    const nodes: Node[] = [frame]; let index: string | null = null;
    const walk = (n: Node, parent: string, root = false) => {
        const { instanceOf, overrides, component, fillStyle, strokeStyle, textStyle, ...copy } = structuredClone(n);
        copy.parent = parent;
        if (root) {
            const m = worldMatrix(expanded, n, sizeOf), size = sizeOf(n);
            copy.rotation = n.type === 'group' ? 0 : matrixAngle(m);
            copy.x = m[4] - r.x - size.w / 2 + m[0] * size.w / 2 + m[2] * size.h / 2;
            copy.y = m[5] - r.y - size.h / 2 + m[1] * size.w / 2 + m[3] * size.h / 2;
            index = between(index); copy.index = index;
        }
        nodes.push(copy); children(expanded, n.id).forEach(c => walk(c, copy.id));
    };
    roots.forEach(n => walk(n, frame.id, true));
    return { id: crypto.randomUUID(), name: frame.name, category: 'Yours', w: frame.w, h: frame.h, nodes, file };
}

export function savedTemplates() { return readTemplates(localStorage); }
export function saveTemplate(template: Template) { writeTemplates(localStorage, [...savedTemplates(), template]); }
export function deleteTemplate(id: string) { writeTemplates(localStorage, savedTemplates().filter(t => t.id !== id)); }
export const allTemplates = () => [...builtInTemplates, ...savedTemplates()];

export async function insertTemplate(template: Template, store: Store, viewport: Viewport, renderer: Renderer, file: string, initial = false) {
    if (store.readOnly) return;
    if (template.file && template.file !== file) {
        const assets = new Set(template.nodes.flatMap(n => nodeFills(n).flatMap(p => p.type === 'image' ? [p.asset] : [])));
        await Promise.all([...assets].map(hash => copyAsset(template.file!, file, hash)));
    }
    const occupied = [...store.pageDoc.values()].filter(n => n.type !== 'page').map(n => aabb(store.doc, n, sizeOf));
    const { root, ops } = insertionOps(template, store.doc, store.currentPage ?? null, viewport.world({ x: renderer.width / 2, y: renderer.height / 2 }), occupied, initial ? file : undefined);
    store.commit(ops); store.selection.clear(); store.selection.add(root.id); store.changed();
    viewport.zoom = Math.max(.05, Math.min(2, (renderer.width - 100) / root.w, (renderer.height - 100) / root.h));
    viewport.x = (renderer.width - root.w * viewport.zoom) / 2 - root.x * viewport.zoom;
    viewport.y = (renderer.height - root.h * viewport.zoom) / 2 - root.y * viewport.zoom; viewport.changed();
}
