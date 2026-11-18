import { afterEach, expect, it, vi } from 'vitest';
import { TextEditor } from '../src/client/tools/text';
import { Store } from '../src/client/store';
import { Viewport } from '../src/client/viewport';
import { makeNode, maxTextLength } from '../src/shared/doc';
import type { Context } from '../src/client/tools/tool';

afterEach(() => vi.unstubAllGlobals());
it('retains oversized text through blur, close, keyboard exit and remote changes until shortened', () => {
    const input = Object.assign(new EventTarget(), {
        value: '', style: {}, setAttribute() {}, focus: vi.fn(), select() {}, setSelectionRange() {}, remove: vi.fn(),
        oninput: undefined as undefined | (() => void), onblur: undefined as undefined | (() => void),
        onkeydown: undefined as undefined | ((event: KeyboardEvent) => void),
    });
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas' ? { getContext: () => ({ measureText: (text: string) => ({ width: text.length * 10 }) }) } : input }); vi.stubGlobal('alert', vi.fn());
    const store = new Store(), node = makeNode('text', 0, 0);
    store.init([node]);
    const ctx: Context = { store, viewport: new Viewport(() => {}), invalidate() {} };
    const canvas = { parentElement: { append() {} }, focus: vi.fn() };
    const editor = new TextEditor(ctx, canvas as unknown as HTMLCanvasElement);
    editor.open(node);
    const draft = 'x'.repeat(maxTextLength + 1); input.value = draft; input.oninput!();
    expect(alert).toHaveBeenCalled(); expect(store.doc.get(node.id)?.text).toBe(node.text);
    input.onblur!(); expect(editor.close()).toBe(false);
    input.onkeydown!({ key: 'Escape', preventDefault() {} } as KeyboardEvent);
    store.set(node.id, { x: 20 });
    expect(input.value).toBe(draft); expect(input.remove).not.toHaveBeenCalled(); expect(canvas.focus).not.toHaveBeenCalled();
    expect(ctx.editingText).toBe(node.id);
    input.value = ''; input.oninput!(); expect(store.doc.get(node.id)?.text).toBe('');
    editor.close(); expect(input.remove).toHaveBeenCalled(); expect(ctx.editingText).toBeUndefined();
});
