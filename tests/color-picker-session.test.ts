import { afterEach, expect, it, vi } from 'vitest';
import { installColorPicker } from '../src/client/ui/color-picker';
import { Store } from '../src/client/store';
import type { Sync } from '../src/client/sync';

class Field extends EventTarget {
    children: Field[] = [];
    parent?: Field;
    value = '#ff4f00'; type = ''; disabled = false; className = ''; textContent = '';
    style: Record<string, string> = {};
    attributes: Record<string, string> = {};
    onclick?: () => void;
    onkeydown?: (e: KeyboardEvent) => void;
    append(...children: Field[]) { children.forEach(c => { c.parent = this; this.children.push(c); }); }
    replaceChildren() { this.children = []; }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
    focus() { dom.activeElement = this; }
    contains(target: unknown): boolean { return target === this || this.children.some(c => c.contains(target)); }
    closest() { return dom.body; }
    getBoundingClientRect() { return { left: 500, top: 100 }; }
    remove() { this.parent!.children = this.parent!.children.filter(c => c !== this); }
}
let dom: EventTarget & { body: Field; activeElement?: Field; createElement: () => Field };
afterEach(() => vi.unstubAllGlobals());
function setup() {
    dom = Object.assign(new EventTarget(), { body: new Field(), createElement: () => new Field() });
    vi.stubGlobal('document', dom);
    vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
    vi.stubGlobal('HTMLInputElement', Field);
    vi.stubGlobal('FocusEvent', Event);
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    const source = new Field(); source.type = 'color'; dom.body.append(source);
    installColorPicker(new Store(), { styles: [] } as unknown as Sync);
    const click = new Event('click', { cancelable: true }); Object.defineProperty(click, 'target', { value: source }); dom.dispatchEvent(click);
    const panel = dom.body.children[1];
    const all = (root: Field): Field[] => [root, ...root.children.flatMap(all)];
    const fields = all(panel);
    const use = (color: string) => fields.find(f => f.attributes['aria-label'] === `Use ${color}`)!.onclick!();
    const escape = () => dom.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
    return { source, panel, fields, use, escape };
}
it('commits the picked color even when a change-only control refreshes its source value', () => {
    const { source, use, escape } = setup();
    const commit = vi.fn(); source.addEventListener('change', () => commit(source.value));
    use('#193b50');
    source.value = '#ff4f00';
    escape();
    expect(commit).toHaveBeenCalledExactlyOnceWith('#193b50');
});
it('does not commit an unchanged picker session', () => {
    const { source, escape } = setup(); const commit = vi.fn(); source.addEventListener('change', commit);
    escape(); expect(commit).not.toHaveBeenCalled();
});
it('lets square arrow keys reach the target before containing them at the panel', () => {
    const { fields, source, panel, escape } = setup();
    const square = fields.find(f => f.className === 'color-square')!;
    const key = Object.assign(new Event('keydown', { cancelable: true }), { key: 'ArrowLeft', shiftKey: false }) as KeyboardEvent;
    Object.defineProperty(key, 'target', { value: square });
    const stop = vi.spyOn(key, 'stopPropagation');
    dom.dispatchEvent(key);
    expect(stop).not.toHaveBeenCalled();
    square.onkeydown!(key);
    expect(source.value).not.toBe('#ff4f00');
    expect(key.defaultPrevented).toBe(true);
    panel.onkeydown!(key);
    expect(stop).toHaveBeenCalledOnce();
    escape();
});
