import { expect, it, vi, afterEach } from 'vitest';
import { builtInTemplates, insertionOps, readTemplates, writeTemplates, templateStorageKey } from '../src/shared/templates';
import { applyOp, between, children, validNode, makeNode, type Doc } from '../src/shared/doc';
import { canEditTemplates, selectionTemplate, insertTemplate } from '../src/client/templates';
import { instanceNode } from '../src/shared/components';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import type { Renderer } from '../src/client/renderer';
import { aabb, worldMatrix } from '../src/shared/geometry';

afterEach(() => vi.unstubAllGlobals());
it('keeps the landing hero headline column clear of both rotated book covers', () => {
    const template = builtInTemplates.find(t => t.id === 'landing')!;
    const doc: Doc = new Map(template.nodes.map(n => [n.id, n]));
    const headline = template.nodes.find(n => n.text?.startsWith('Independent books.'))!;
    for (const cover of template.nodes.filter(n => n.type === 'rect' && n.rotation)) {
        expect(headline.x + headline.w + 32).toBeLessThanOrEqual(aabb(doc, cover).x);
    }
});
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
it('round trips reverse selections across parents in document paint order', () => {
    const back = makeNode('frame', 0, 0), front = makeNode('frame', 0, 0, between(back.index));
    const backChild = { ...makeNode('rect', 10, 10), parent: back.id, name: 'Back' };
    const frontChild = { ...makeNode('rect', 10, 10), parent: front.id, name: 'Front' };
    const doc: Doc = new Map([frontChild, front, backChild, back].map(n => [n.id, n]));
    const template = selectionTemplate(doc, [frontChild.id, backChild.id], 'file');
    let json = ''; writeTemplates({ setItem: (_k, value) => { json = value; } }, [template]);
    const stored = readTemplates({ getItem: () => json })[0];
    const restored: Doc = new Map(); const { ops, root } = insertionOps(stored, restored, null, { x: 0, y: 0 });
    ops.forEach(op => applyOp(restored, op));
    expect(children(restored, root.id).map(n => n.name)).toEqual(['Back', 'Front']);
});
it('preserves descendant world transforms when saving a group inside a rotated frame', () => {
    const frame = { ...makeNode('frame', 200, 300), w: 400, h: 300, rotation: 90 };
    const group = { ...makeNode('group', 25, 40), parent: frame.id, w: 180, h: 120 };
    const nested = { ...makeNode('group', 5, 12), parent: group.id };
    const rect = { ...makeNode('rect', 20, 30), parent: nested.id, w: 70, h: 35, rotation: 15 };
    const childFrame = { ...makeNode('frame', 80, 50), parent: group.id, w: 80, h: 40 };
    const child = { ...makeNode('ellipse', 3, 5), parent: childFrame.id, w: 12, h: 12 };
    const doc: Doc = new Map([frame, group, nested, rect, childFrame, child].map(n => [n.id, n]));
    const template = selectionTemplate(doc, [group.id], 'file'), saved: Doc = new Map(template.nodes.map(n => [n.id, n]));
    const origin = aabb(doc, group);
    expect(saved.get(group.id)?.rotation).toBe(0); expect(saved.get(nested.id)?.rotation).toBe(0);
    for (const node of [rect, childFrame, child]) {
        const before = worldMatrix(doc, node), after = worldMatrix(saved, saved.get(node.id)!);
        before.forEach((v, i) => expect(after[i]).toBeCloseTo(v - (i === 4 ? origin.x : i === 5 ? origin.y : 0)));
    }
});
it('blocks edits and insertion in history preview without changing selection, history or viewport', async () => {
    const store = new Store(), existing = makeNode('rect', 0, 0); store.init([existing]); store.selection.add(existing.id);
    const renderer = { width: 1000, height: 800, preview: new Map() } as Renderer;
    const viewport = new Viewport(vi.fn()), before = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    expect(canEditTemplates(store, renderer)).toBe(false);
    await insertTemplate(builtInTemplates[0], store, viewport, renderer, 'file');
    expect([...store.doc.keys()]).toEqual([existing.id]); expect([...store.selection]).toEqual([existing.id]);
    expect(store.undoStack).toHaveLength(0); expect(viewport).toMatchObject(before);
    renderer.preview = null; expect(canEditTemplates(store, renderer)).toBe(true);
    store.readOnly = true; expect(canEditTemplates(store, renderer)).toBe(false);
});
it('refuses insertion if copying image assets fails without creating partial content', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const node = { ...makeNode('frame', 0, 0), fills: [{ type: 'image' as const, asset: 'a'.repeat(64), fit: 'fill' as const, w: 100, h: 100, opacity: 1, visible: true }] };
    const store = new Store();
    await expect(insertTemplate({ id: 'image', name: 'Image', category: 'Yours', w: 100, h: 100, nodes: [node], file: 'source' }, store, new Viewport(() => {}), { width: 1000, height: 800 } as Renderer, 'target')).rejects.toThrow('Asset unavailable');
    expect(store.doc.size).toBe(0);
});
