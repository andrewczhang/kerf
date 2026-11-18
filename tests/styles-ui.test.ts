import { afterEach, expect, it, vi } from 'vitest';
import { styleLibrary } from '../src/client/ui/styles';
import { Store } from '../src/client/store';
import type { Sync } from '../src/client/sync';
import type { Style } from '../src/shared/styles';

class Element {
    children: Element[] = [];
    parent?: Element;
    className = '';
    textContent = '';
    value = '';
    style: Record<string, string> = {};
    attributes: Record<string, string> = {};
    onclick?: () => void;
    oninput?: () => void;
    onchange?: () => void;
    classList = { contains: (name: string) => this.className === name };
    append(...children: (Element | string)[]) { for (const child of children) if (typeof child !== 'string') { child.parent = this; this.children.push(child); } }
    after(child: Element) { child.parent = this.parent; this.parent!.children.splice(this.parent!.children.indexOf(this) + 1, 0, child); }
    get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1]; }
    remove() { this.parent!.children.splice(this.parent!.children.indexOf(this), 1); }
    setAttribute(key: string, value: string) { this.attributes[key] = value; }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function setup(style: Style) {
    vi.useFakeTimers();
    vi.stubGlobal('document', { createElement: () => new Element() });
    vi.stubGlobal('Option', class extends Element {});
    const parent = new Element(), send = vi.fn();
    styleLibrary(parent as unknown as HTMLElement, new Store(), { styles: [style], send } as unknown as Sync);
    const section = parent.children[style.kind === 'color' ? 1 : 2], row = section.children[1];
    row.onclick!();
    const editor = row.nextElementSibling!;
    const field = (key: string) => editor.children.flatMap(label => label.children).find(field => field.attributes['aria-label'] === 'Style ' + key)!;
    const edit = (key: string, value: string) => { const input = field(key); input.value = value; (input.oninput ?? input.onchange)!(); return input; };
    return { row, editor, field, edit, send, name: row.children[1].children[0], spec: row.children[1].children[1], sample: row.children[0] };
}

it('updates the color row immediately without replacing the editor or its inputs', () => {
    const { row, editor, edit, field, send, name, spec, sample } = setup({ id: 'color', kind: 'color', name: 'Orange', color: '#ff4f00' });
    const input = edit('name', 'Ocean');
    expect(name.textContent).toBe('Ocean');
    expect(send).not.toHaveBeenCalled();
    edit('color', '#112233');
    expect(sample.style.backgroundColor).toBe('#112233');
    expect(spec.textContent).toBe('#112233 · 0 layers');
    expect(row.nextElementSibling).toBe(editor);
    expect(field('name')).toBe(input);
    expect(send).toHaveBeenLastCalledWith({ type: 'style-upsert', style: { id: 'color', kind: 'color', name: 'Ocean', color: '#112233' } });
    row.onclick!(); row.onclick!();
    expect(row.nextElementSibling!.children[0].children[0].value).toBe('Ocean');
});

it('updates text name, sample and spec while retaining incomplete or invalid drafts in the input', () => {
    const { row, editor, edit, field, send, name, spec, sample } = setup({ id: 'text', kind: 'text', name: 'Body', fontFamily: 'sans', fontSize: 24, fontWeight: 400 });
    edit('name', 'Heading');
    edit('fontFamily', 'serif');
    edit('fontWeight', '700');
    const input = edit('fontSize', '40');
    expect(name.textContent).toBe('Heading');
    expect(sample.style).toMatchObject({ fontFamily: 'Georgia, serif', fontWeight: '700' });
    expect(spec.textContent).toBe('serif 40 · 700 · 0 layers');
    vi.advanceTimersByTime(250);
    expect(send).toHaveBeenLastCalledWith({ type: 'style-upsert', style: { id: 'text', kind: 'text', name: 'Heading', fontFamily: 'serif', fontSize: 40, fontWeight: 700 } });
    send.mockClear();
    for (const value of ['', '-1', '999999']) { edit('fontSize', value); vi.advanceTimersByTime(250); expect(input.value).toBe(value); }
    expect(spec.textContent).toBe('serif 40 · 700 · 0 layers');
    expect(send).not.toHaveBeenCalled();
    expect(row.nextElementSibling).toBe(editor);
    expect(field('fontSize')).toBe(input);
});
