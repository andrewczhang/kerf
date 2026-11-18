import { afterEach, expect, it, vi } from 'vitest';
import { historyPanel } from '../src/client/ui/history';
import type { Sync } from '../src/client/sync';
import type { Renderer } from '../src/client/renderer';

class Element {
    children: Element[] = [];
    className = '';
    hidden = false;
    inert = false;
    value = '';
    textContent = '';
    innerHTML = '';
    onclick?: () => void;
    onkeydown?: () => void;
    classList = { toggle: vi.fn() };
    append(...els: Element[]) { this.children.push(...els); }
    replaceChildren() { this.children = []; }
    querySelector(selector: string): Element | null {
        if (this.innerHTML.includes('<' + selector)) return this.children.find(e => e.className === selector) ?? this.field(selector);
        for (const child of this.children) { const found = child.querySelector(selector); if (found) return found; }
        return null;
    }
    field(tag: string) { const e = new Element(); e.className = tag; this.children.push(e); return e; }
    contains() { return false; }
    focus() {}
}
afterEach(() => vi.unstubAllGlobals());
it('makes the inspector and layers inert only while previewing a saved version', () => {
    const body = new Element(), inspector = new Element(), layers = new Element();
    vi.stubGlobal('document', { body, activeElement: null, createElement: () => new Element(), querySelector: (selector: string) => selector === '.inspector' ? inspector : selector === '.layers' ? layers : null });
    vi.stubGlobal('window', { addEventListener() {} });
    const sync = Object.assign(new EventTarget(), { versions: [{ id: 'saved', at: 0, author: 'Alex', nodeCount: 0, name: 'Saved' }], send: vi.fn() });
    const renderer = { preview: null, canvas: { style: { pointerEvents: '' }, focus() {} }, invalidate: vi.fn() };
    const toggle = historyPanel(sync as unknown as Sync, renderer as unknown as Renderer);
    toggle(); const panel = body.children[0]; panel.children.find(e => e.className.startsWith('version-row'))!.onclick!();
    sync.dispatchEvent(new CustomEvent('preview', { detail: { id: 'wrong', nodes: [] } })); expect(inspector.inert).toBe(false);
    sync.dispatchEvent(new CustomEvent('preview', { detail: { id: 'saved', nodes: [] } }));
    expect(inspector.inert).toBe(true); expect(layers.inert).toBe(true); expect(inspector.classList.toggle).toHaveBeenLastCalledWith('previewing', true);
    toggle(); expect(inspector.inert).toBe(false); expect(layers.inert).toBe(false); expect(renderer.preview).toBeNull();
});
