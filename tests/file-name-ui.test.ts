import { afterEach, expect, it, vi } from 'vitest';
import { fileName } from '../src/client/ui/file-name';
import { commands } from '../src/client/ui/palette';
import type { Sync } from '../src/client/sync';

afterEach(() => { vi.unstubAllGlobals(); commands.clear(); });
it.each(['Enter', 'Escape'])('ignores composing %s until a non-composition key event', key => {
    const field = { value: '', setAttribute() {}, focus() {}, select() {}, remove: vi.fn(), onkeydown: undefined as ((e: KeyboardEvent) => void) | undefined };
    const label = { hidden: false, setAttribute() {}, after() {}, focus: vi.fn(), onclick: undefined as (() => void) | undefined };
    vi.stubGlobal('document', { querySelector: () => label, createElement: () => field });
    const send = vi.fn();
    const sync = Object.assign(new EventTarget(), { ready: true, name: 'Initial', send });
    fileName(sync as unknown as Sync, () => true);
    label.onclick!(); field.value = '中文';
    for (const composition of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
        const preventDefault = vi.fn();
        field.onkeydown!({ key, ...composition, stopPropagation() {}, preventDefault } as unknown as KeyboardEvent);
        expect(preventDefault).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
        expect(field.remove).not.toHaveBeenCalled(); expect(label.hidden).toBe(true);
    }
    field.onkeydown!({ key, isComposing: false, keyCode: key === 'Enter' ? 13 : 27, stopPropagation() {}, preventDefault() {} } as unknown as KeyboardEvent);
    expect(field.remove).toHaveBeenCalledOnce(); expect(label.hidden).toBe(false);
    if (key === 'Enter') expect(send).toHaveBeenCalledWith({ type: 'rename', name: '中文' });
    else expect(send).not.toHaveBeenCalled();
});
