import { afterEach, expect, it, vi } from 'vitest';
import { TextEditor, textEditorClip } from '../src/client/tools/text';
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
    const ctx: Context = { store, viewport: new Viewport(() => {}), invalidate() {} };
    const canvas = Object.assign(new EventTarget(), { parentElement: { append() {} }, focus: vi.fn() });
    const editor = new TextEditor(ctx, canvas as unknown as HTMLCanvasElement);
    editor.open(node, true);
    const draft = 'x'.repeat(maxTextLength + 1); input.value = draft; input.oninput!();
    expect(alert).toHaveBeenCalled(); expect(store.doc.get(node.id)?.text).toBe(node.text);
    input.onblur!(); expect(editor.close()).toBe(false);
    const toolDown = vi.fn(() => store.begin()); canvas.addEventListener('pointerdown', toolDown);
    const down = new Event('pointerdown', { cancelable: true }); canvas.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true); expect(toolDown).not.toHaveBeenCalled();
    input.onkeydown!({ key: 'Escape', preventDefault() {} } as KeyboardEvent);
    store.remote([{ t: 'set', id: node.id, key: 'x', value: 20 }]);
    expect(input.value).toBe(draft); expect(input.remove).not.toHaveBeenCalled(); expect(canvas.focus).not.toHaveBeenCalled();
    expect(ctx.editingText).toBe(node.id);
    input.value = ''; input.oninput!(); expect(store.doc.get(node.id)?.text).toBe('');
    input.value = 'New'; input.oninput!(); input.value = 'New text'; input.oninput!();
    editor.close(); expect(input.remove).toHaveBeenCalled(); expect(ctx.editingText).toBeUndefined();
    expect(store.undoStack).toHaveLength(1);
    store.history(); expect(store.doc.has(node.id)).toBe(false);
});

it('clips the text editor to nested frames through groups, without trimming the text', () => {
    const outer = { ...makeNode('frame', 100, 30), w: 130, h: 55 };
    const inner = { ...makeNode('frame', 40, 10), parent: outer.id };
    const group = { ...makeNode('group', 0, 0), parent: inner.id };
    const text = { ...makeNode('text', 20, 20), parent: group.id, text: 'SATURDAY STUDIO / OPEN' };
    const doc = new Map([outer, inner, group, text].map(n => [n.id, n]));
    expect(textEditorClip(doc, text, { x: 160, y: 60, w: 180, h: 30 })).toBe('inset(0px 110px 5px 0px)');
    const rotated = new Map(doc).set(outer.id, { ...outer, rotation: 30 });
    expect(textEditorClip(rotated, text, { x: 160, y: 60, w: 180, h: 30 })).toBe('inset(0px 110px 5px 0px)');
    expect(textEditorClip(doc, { ...text, parent: null }, { x: 160, y: 60, w: 180, h: 30 })).toBe('');
    expect(text.text).toBe('SATURDAY STUDIO / OPEN');
});
