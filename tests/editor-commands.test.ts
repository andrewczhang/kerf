import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../src/client/ui/palette';
import { editorCommands } from '../src/client/ui/editor-commands';
import { registry } from '../src/client/tools/tool';
import type { Context } from '../src/client/tools/tool';
import type { Renderer } from '../src/client/renderer';
import { Store } from '../src/client/store';
import { makeNode } from '../src/shared/doc';
import { instanceNode } from '../src/shared/components';
import { downloadSelection } from '../src/client/export';

const { prepare } = vi.hoisted(() => ({ prepare: { current: () => {} } }));
vi.mock('../src/client/ui/palette', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/ui/palette')>(), installPalette: (_: unknown, fn: () => void) => { prepare.current = fn; return () => {}; } }));
vi.mock('../src/client/export', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/export')>(), downloadSelection: vi.fn() }));
afterEach(() => { commands.clear(); registry.clear(); vi.unstubAllGlobals(); });
describe('editor palette commands', () => {
    it('enables exports for deep-selected instance layers but not missing or empty selections', () => {
        vi.stubGlobal('document', { createElement: () => ({}), querySelector: () => ({ prepend() {} }), querySelectorAll: () => [] });
        const store = new Store(), main = { ...makeNode('frame', 0, 0), component: true }, child = { ...makeNode('rect', 0, 0), parent: main.id }, instance = instanceNode(main, 200, 0);
        store.init([main, child, instance]); store.selection.add(instance.id + '/' + child.id);
        editorCommands({ store, viewport: {} } as unknown as Context, { preview: null, canvas: {} } as unknown as Renderer, vi.fn());
        for (const format of ['png', 'svg']) {
            const command = commands.get('export-' + format)!;
            expect(command.enabled!()).toBe(true); command.run();
            expect(downloadSelection).toHaveBeenCalledWith(store.doc, store.selection, format, format === 'png' ? 2 : 1);
            store.selection = new Set(['missing']); expect(command.enabled!()).toBe(false);
            store.selection.clear(); expect(command.enabled!()).toBe(false);
            store.selection.add(instance.id + '/' + child.id);
        }
    });
    it('creates components and detaches instances through registered commands', () => {
        vi.stubGlobal('document', { createElement: () => ({}), querySelector: () => ({ prepend() {} }), querySelectorAll: () => [] });
        const store = new Store(), rect = makeNode('rect', 0, 0);
        store.init([rect]);
        editorCommands({ store, viewport: {} } as unknown as Context, { preview: null, canvas: {} } as unknown as Renderer, vi.fn());
        expect(commands.get('create-component')!.enabled!()).toBe(false);
        expect(commands.get('detach-instance')!.enabled!()).toBe(false);
        const selection = store.selection;
        store.selection.add(rect.id); commands.get('create-component')!.run();
        const main = store.doc.get([...store.selection][0])!;
        expect(store.selection).toBe(selection); expect([...selection]).toEqual([main.id]);
        expect(main.component).toBe(true);
        const instance = { ...makeNode('frame', 200, 0), instanceOf: main.id };
        store.commit([{ t: 'create', node: instance }]); store.selection = new Set([instance.id]);
        expect(commands.get('detach-instance')!.enabled!()).toBe(true);
        commands.get('detach-instance')!.run(); expect(store.doc.get(instance.id)?.instanceOf).toBeUndefined();
    });
    it('excludes pointer-only gradient markers while keeping clickable panel actions', () => {
        const markerClick = vi.fn(), actionClick = vi.fn();
        const marker = { getClientRects: () => [{}], closest: (selector: string) => selector.includes('.stop-strip') ? {} : null, matches: () => false, dataset: {}, getAttribute: () => 'Gradient stop 1', click: markerClick };
        const action = { ...marker, closest: () => null, getAttribute: () => 'Reverse', click: actionClick };
        vi.stubGlobal('document', { createElement: () => ({}), querySelector: () => ({ prepend() {} }), querySelectorAll: (selector: string) => selector.startsWith('header button') ? [marker, action] : [] });
        editorCommands({ store: {}, viewport: {} } as unknown as Context, { preview: null, canvas: {} } as unknown as Renderer, vi.fn()); prepare.current();
        expect([...commands.values()].some(c => c.title === 'Gradient stop 1')).toBe(false);
        [...commands.values()].find(c => c.title === 'Reverse')!.run();
        expect(actionClick).toHaveBeenCalledOnce(); expect(markerClick).not.toHaveBeenCalled();
    });
    it.each(['preview', 'inspect'])('keeps read-only panel actions available during %s', mode => {
        const copy = vi.fn(), mutate = vi.fn();
        const button = { getClientRects: () => [{}], closest: (selector: string) => selector === 'aside' ? {} : null, dataset: {} };
        const copyButton = { ...button, matches: () => true, getAttribute: () => 'Copy CSS', click: copy };
        const editButton = { ...button, matches: () => false, getAttribute: () => 'Hide paint', click: mutate };
        vi.stubGlobal('document', { createElement: () => ({}), querySelector: () => ({ prepend() {} }), querySelectorAll: (selector: string) => selector.startsWith('header button') ? [copyButton, editButton] : [] });
        editorCommands({ store: {}, viewport: {} } as unknown as Context, { preview: mode === 'preview' ? new Map() : null, canvas: {} } as unknown as Renderer, vi.fn(), () => mode === 'inspect'); prepare.current();
        const readOnly = [...commands.values()].find(c => c.title === 'Copy CSS')!;
        const editing = [...commands.values()].find(c => c.title === 'Hide paint')!;
        expect(readOnly.enabled?.()).toBe(true); readOnly.run(); expect(copy).toHaveBeenCalledOnce();
        expect(editing.enabled?.()).toBe(false); editing.run(); expect(mutate).not.toHaveBeenCalled();
    });
    it.each(['preview', 'inspect'])('blocks mutations during %s and restores them on return to editing', mode => {
        vi.stubGlobal('document', { createElement: () => ({}), querySelector: () => ({ prepend() {} }), querySelectorAll: () => [] });
        const history = vi.fn(), onKey = vi.fn(), set = vi.fn(), choose = vi.fn();
        const store = { selection: new Set(['node']), doc: new Map([['node', { hidden: false }]]), history, set, begin() {}, end() {} };
        const renderer = { preview: null, canvas: {} } as unknown as Renderer;
        let inspecting = false;
        registry.set('select', { id: 'select', onKey } as never);
        editorCommands({ store, viewport: {} } as unknown as Context, renderer, choose, () => inspecting); prepare.current();
        for (const id of ['undo', 'redo', 'delete', 'duplicate', 'group', 'ungroup', 'toggle-hidden', 'toggle-locked', 'tool-select']) expect(commands.get(id)?.enabled?.()).toBe(true);
        if (mode === 'preview') renderer.preview = new Map();
        else inspecting = true;
        for (const id of ['undo', 'redo', 'delete', 'duplicate', 'group', 'ungroup', 'toggle-hidden', 'toggle-locked', 'tool-select']) {
            expect(commands.get(id)?.enabled?.()).toBe(false); commands.get(id)!.run();
        }
        expect(history).not.toHaveBeenCalled(); expect(onKey).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled();
        expect(commands.get('home')?.enabled?.()).toBe(true);
        renderer.preview = null;
        inspecting = false;
        commands.get('undo')!.run(); expect(history).toHaveBeenCalledOnce();
    });
});
