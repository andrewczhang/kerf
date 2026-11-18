import { afterEach, expect, it, vi } from 'vitest';
import { makeNode } from '../src/shared/doc';
import { instanceNode } from '../src/shared/components';
import { toHTML, toReact } from '../src/shared/codegen';
import { Store } from '../src/client/store';
import { codepanel, codePanelScope } from '../src/client/ui/codepanel';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
function fixture() {
    const store = new Store(), main = { ...makeNode('frame', 0, 0), component: true };
    const child = { ...makeNode('rect', 10, 10), parent: main.id, w: 30, h: 30 };
    const instance = { ...instanceNode(main, 200, 0), overrides: { [child.id]: { fill: '#123456' } } };
    store.init([main, child, instance]); store.selection.add(instance.id);
    return { store, main, child, instance };
}
it('generates inherited and overridden layers for instances and virtual selections', () => {
    const { store, main, child, instance } = fixture(), scope = codePanelScope(store.doc, store.selection);
    expect(scope.rootId).toBe(instance.id); expect(scope.readOnly).toBe(true);
    expect(scope.doc.get(instance.id + '/' + child.id)).toMatchObject({ fill: '#123456', w: 30 });
    for (const code of [toReact(scope.doc, scope.rootId), toHTML(scope.doc, scope.rootId)]) {
        expect(code).toContain(instance.id + '/' + child.id); expect(code).toContain('#123456');
    }
    store.set(child.id, { radius: 12 });
    expect(codePanelScope(store.doc, [instance.id + '/' + child.id])).toMatchObject({ rootId: instance.id, readOnly: true });
    const next = codePanelScope(store.doc, store.selection);
    expect(toReact(next.doc, next.rootId)).not.toBe(toReact(scope.doc, scope.rootId));
    expect(codePanelScope(store.doc, [main.id]).readOnly).toBe(false);
    expect(codePanelScope(store.doc, []).readOnly).toBe(true);
    const empty = codePanelScope(new Map(), []);
    expect(empty.rootId).toBeNull(); expect(empty.ids.size).toBe(0); expect(empty.readOnly).toBe(false);
});

class PanelElement {
    nodes = new Map<string, PanelElement>();
    style = {};
    classList = { toggle() {} };
    value = ''; textContent = ''; srcdoc = ''; readOnly = false; hidden = true;
    selectionStart = 0; selectionEnd = 0; scrollTop = 0; scrollLeft = 0;
    clientWidth = 500; clientHeight = 300;
    attributes: Record<string, string> = {};
    oninput?: () => void; onblur?: () => void; onclick?: () => void;
    querySelector(selector: string): PanelElement { if (!this.nodes.has(selector)) this.nodes.set(selector, new PanelElement()); return this.nodes.get(selector)!; }
    closest() { return this; }
    append() {} replaceChildren() {} setSelectionRange() {}
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
}
it('keeps instance code read-only, previews resolved layers, and still edits plain main code', () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: () => new PanelElement(), createTextNode: () => new PanelElement(), activeElement: null });
    vi.stubGlobal('window', { setTimeout, innerWidth: 1200 });
    vi.stubGlobal('ResizeObserver', class { observe() {} });
    const { store, main, child } = fixture(), el = new PanelElement(), panel = codepanel(el as unknown as HTMLElement, store);
    panel.activate(true);
    const input = el.querySelector('textarea'), code = input.value;
    expect(input.readOnly).toBe(true); expect(code).toContain('#123456');
    input.value = '<div />'; input.oninput!(); input.onblur!();
    expect(input.value).toBe(code); expect(store.undoStack).toHaveLength(0);
    el.querySelector('[data-code-action="preview"]').onclick!();
    expect(el.querySelector('iframe').srcdoc).toContain('#123456');
    store.selection = new Set([main.id]); store.changed();
    expect(input.readOnly).toBe(false);
    input.value = input.value.replace('#ff4f00', '#abcdef'); input.oninput!(); vi.advanceTimersByTime(250);
    expect(store.doc.get(child.id)?.fill).toBe('#abcdef');
    const count = store.undoStack.length;
    input.value = '<broken'; input.oninput!(); vi.advanceTimersByTime(250);
    expect(input.attributes['aria-invalid']).toBe('true'); expect(store.undoStack).toHaveLength(count);
});
