import { expect, it, vi, afterEach } from 'vitest';
import { builtInTemplates, insertionOps, readTemplates, writeTemplates, templateStorageKey } from '../src/shared/templates';
import { applyOp, validNode, makeNode, type Doc } from '../src/shared/doc';
import { selectionTemplate, insertTemplate } from '../src/client/templates';
import { instanceNode } from '../src/shared/components';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import type { Renderer } from '../src/client/renderer';

afterEach(() => vi.unstubAllGlobals());
it.each(builtInTemplates)('$name is a valid connected tree with unique ids', template => {
    const doc: Doc = new Map();
    for (const n of template.nodes) {
        expect(validNode(n), n.name).toBe(true);
        expect(doc.has(n.id)).toBe(false);
        if (n.parent) expect(doc.has(n.parent)).toBe(true);
        applyOp(doc, { t: 'create', node: n });
    }
    expect(doc.size).toBe(template.nodes.length);
    expect(template.nodes[0]).toMatchObject({ type: 'frame', parent: null, w: template.w, h: template.h });
});
it('creates fresh ids and page parents without changing the source; places beside occupied space', () => {
    const template = builtInTemplates[0], original = structuredClone(template);
    const page = makeNode('page', 0, 0), doc: Doc = new Map([[page.id, page]]);
    const first = insertionOps(template, doc, page.id, { x: 0, y: 0 });
    first.ops.forEach(op => applyOp(doc, op));
    const second = insertionOps(template, doc, page.id, { x: 0, y: 0 });
    expect(first.ops.every(op => op.t === 'create')).toBe(true);
    expect(first.root.parent).toBe(page.id);
    expect(second.root.x).toBeGreaterThan(first.root.x + first.root.w);
    for (const op of second.ops) if (op.t === 'create') { expect(doc.has(op.node.id)).toBe(false); expect(template.nodes.some(n => n.id === op.node.id)).toBe(false); }
    second.ops.forEach(op => applyOp(doc, op));
    expect(doc.size).toBe(template.nodes.length * 2 + 1);
    expect(template).toEqual(original);
});
it('deduplicates concurrent initial insertions through stable creation ids', () => {
    const doc: Doc = new Map(), template = builtInTemplates[1];
    const a = insertionOps(template, doc, null, { x: 0, y: 0 }, [], 'new-file');
    const b = insertionOps(template, doc, null, { x: 200, y: 100 }, [], 'new-file');
    [...a.ops, ...b.ops].forEach(op => applyOp(doc, op));
    expect(doc.size).toBe(template.nodes.length);
});
it('inserts as one undoable synced transaction and selects its root', async () => {
    const store = new Store(), sent = vi.fn(); store.send = sent;
    const viewport = new Viewport(() => {}), renderer = { width: 1000, height: 800 } as Renderer;
    await insertTemplate(builtInTemplates[0], store, viewport, renderer, 'file');
    expect(sent).toHaveBeenCalledTimes(1); expect(store.undoStack).toHaveLength(1);
    expect(store.selection.size).toBe(1); expect(store.doc.get([...store.selection][0])?.type).toBe('frame');
    expect(viewport.zoom).toBeLessThan(1);
    store.history(); expect(store.doc.size).toBe(0);
    store.history(true); expect(store.doc.size).toBe(builtInTemplates[0].nodes.length);
});
it('round trips a saved selection, detaches instances, retains image provenance and descendants', () => {
    const main = { ...makeNode('frame', 0, 0), component: true };
    const image = { ...makeNode('rect', 10, 20), parent: main.id, fills: [{ type: 'image' as const, asset: 'a'.repeat(64), fit: 'fill' as const, w: 100, h: 100, opacity: 1, visible: true }] };
    const instance = instanceNode(main, 400, 300), doc: Doc = new Map([main, image, instance].map(n => [n.id, n]));
    const template = selectionTemplate(doc, [instance.id], 'source-file');
    let value = ''; const storage = { getItem: (key: string) => key === templateStorageKey ? value : null, setItem: (_key: string, v: string) => { value = v; } };
    writeTemplates(storage, [template]); expect(readTemplates(storage)).toEqual([template]);
    expect(template.nodes).toHaveLength(3); expect(template.nodes.every(n => !n.instanceOf && !n.component)).toBe(true);
    expect(template.file).toBe('source-file'); expect(template.nodes[2].fills).toEqual(image.fills);
    const pasted: Doc = new Map(); insertionOps(readTemplates(storage)[0], pasted, null, { x: 0, y: 0 }).ops.forEach(op => applyOp(pasted, op)); expect(pasted.size).toBe(3);
    writeTemplates(storage, []); expect(readTemplates(storage)).toEqual([]);
});
it('handles empty selection and corrupt or invalid storage', () => {
    expect(() => selectionTemplate(new Map(), [], 'file')).toThrow('Select one or more layers first.');
    for (const value of [null, '{bad', '{}', '[{}]', JSON.stringify([{ ...builtInTemplates[0], category: 'Yours', nodes: [builtInTemplates[0].nodes[0], builtInTemplates[0].nodes[0]] }])]) expect(readTemplates({ getItem: () => value })).toEqual([]);
    expect(readTemplates({ getItem: () => { throw Error('denied'); } })).toEqual([]);
    expect(() => writeTemplates({ setItem: () => { throw Error('full'); } }, [])).toThrow('full');
});
it('refuses insertion if copying image assets fails without creating partial content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const node = { ...makeNode('frame', 0, 0), fills: [{ type: 'image' as const, asset: 'a'.repeat(64), fit: 'fill' as const, w: 100, h: 100, opacity: 1, visible: true }] };
    const store = new Store();
    await expect(insertTemplate({ id: 'image', name: 'Image', category: 'Yours', w: 100, h: 100, nodes: [node], file: 'source' }, store, new Viewport(() => {}), { width: 1000, height: 800 } as Renderer, 'target')).rejects.toThrow('Asset unavailable');
    expect(store.doc.size).toBe(0);
});
