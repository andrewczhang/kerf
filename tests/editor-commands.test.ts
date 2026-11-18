import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands } from '../src/client/ui/palette';
import { editorCommands } from '../src/client/ui/editor-commands';
import { registry } from '../src/client/tools/tool';
import type { Context } from '../src/client/tools/tool';
import type { Renderer } from '../src/client/renderer';

const { prepare } = vi.hoisted(() => ({ prepare: { current: () => {} } }));
vi.mock('../src/client/ui/palette', async importOriginal => ({ ...await importOriginal<typeof import('../src/client/ui/palette')>(), installPalette: (_: unknown, fn: () => void) => { prepare.current = fn; return () => {}; } }));
afterEach(() => { commands.clear(); registry.clear(); vi.unstubAllGlobals(); });
describe('editor palette commands', () => {
    it('blocks mutations during version preview and restores them on return to current', () => {
        vi.stubGlobal('document', { createElement: () => ({}), querySelector: () => ({ prepend() {} }), querySelectorAll: () => [] });
        const history = vi.fn(), onKey = vi.fn(), set = vi.fn(), choose = vi.fn();
        const store = { selection: new Set(['node']), doc: new Map([['node', { hidden: false }]]), history, set, begin() {}, end() {} };
        const renderer = { preview: null, canvas: {} } as unknown as Renderer;
        registry.set('select', { id: 'select', onKey } as never);
        editorCommands({ store, viewport: {} } as unknown as Context, renderer, choose); prepare.current();
        for (const id of ['undo', 'redo', 'delete', 'duplicate', 'group', 'ungroup', 'toggle-hidden', 'toggle-locked', 'tool-select']) expect(commands.get(id)?.enabled?.()).toBe(true);
        renderer.preview = new Map();
        for (const id of ['undo', 'redo', 'delete', 'duplicate', 'group', 'ungroup', 'toggle-hidden', 'toggle-locked', 'tool-select']) {
            expect(commands.get(id)?.enabled?.()).toBe(false); commands.get(id)!.run();
        }
        expect(history).not.toHaveBeenCalled(); expect(onKey).not.toHaveBeenCalled(); expect(set).not.toHaveBeenCalled(); expect(choose).not.toHaveBeenCalled();
        expect(commands.get('home')?.enabled?.()).toBe(true);
        renderer.preview = null;
        commands.get('undo')!.run(); expect(history).toHaveBeenCalledOnce();
    });
});
