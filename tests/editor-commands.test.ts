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
    it('excludes pointer-only gradient markers while keeping clickable panel actions', () => {
        const markerClick = vi.fn(), actionClick = vi.fn();
        const marker = { getClientRects: () => [{}], closest: (selector: string) => selector.includes('.stop-strip') ? {} : null, dataset: {}, getAttribute: () => 'Gradient stop 1', click: markerClick };
        const action = { ...marker, closest: () => null, getAttribute: () => 'Reverse', click: actionClick };
        vi.stubGlobal('document', { createElement: () => ({}), querySelector: () => ({ prepend() {} }), querySelectorAll: (selector: string) => selector.startsWith('header button') ? [marker, action] : [] });
        editorCommands({ store: {}, viewport: {} } as unknown as Context, { preview: null, canvas: {} } as unknown as Renderer, vi.fn()); prepare.current();
        expect([...commands.values()].some(c => c.title === 'Gradient stop 1')).toBe(false);
        [...commands.values()].find(c => c.title === 'Reverse')!.run();
        expect(actionClick).toHaveBeenCalledOnce(); expect(markerClick).not.toHaveBeenCalled();
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
