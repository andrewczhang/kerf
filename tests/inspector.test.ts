import { expect, it } from 'vitest';
import { refreshNumericFields } from '../src/client/ui/inspector';
import { Store } from '../src/client/store';
import { layoutText } from '../src/client/text-layout';
import { makeNode } from '../src/shared/doc';

function fields(values: Record<string, string>) {
    const inputs = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { dataset: { key }, value, placeholder: '' } as unknown as HTMLInputElement]));
    const content = { querySelectorAll: () => Object.values(inputs) } as unknown as HTMLElement;
    return { inputs, content };
}

it('refreshes derived Hug height while width, gap or padding keeps focus without changing the active edit', () => {
    const frame = { ...makeNode('frame', 0, 0), layout: 'vertical' as const, sizeH: 'hug' as const, w: 450, gap: 40, padTop: 10, padRight: 10, padBottom: 10, padLeft: 10 };
    const text = { ...makeNode('text', 0, 0, 'A'), parent: frame.id, sizeW: 'fill' as const, textWidth: 'fixed' as const, fontSize: 20, text: 'a'.repeat(100) };
    const rect = { ...makeNode('rect', 0, 0, 'B'), parent: frame.id, h: 50 };
    const store = new Store(n => layoutText(n, s => s.length * 10));
    store.init([frame, text, rect]);
    const { inputs, content } = fields({ w: '450', h: String(store.doc.get(frame.id)!.h), gap: '40', padTop: '10', padBottom: '10' });
    let active = inputs.w;
    store.addEventListener('change', () => refreshNumericFields(content, [store.doc.get(frame.id)!], active));
    expect(inputs.h.value).toBe('182');
    inputs.w.value = '0200';
    store.begin(); store.set(frame.id, { w: 200 });
    expect(inputs.w.value).toBe('0200');
    expect(inputs.h.value).toBe('254');
    store.changed();
    expect(inputs.h.value).toBe('254');
    active = inputs.gap; inputs.gap.value = '060';
    store.set(frame.id, { gap: 60 });
    expect(inputs.gap.value).toBe('060'); expect(inputs.h.value).toBe('274');
    active = inputs.padTop; inputs.padTop.value = '030';
    store.set(frame.id, { padTop: 30 });
    expect(inputs.padTop.value).toBe('030'); expect(inputs.h.value).toBe('294');
    store.remote([{ t: 'set', id: frame.id, key: 'padBottom', value: 20 }]);
    expect(inputs.padBottom.value).toBe('20'); expect(inputs.h.value).toBe('304');
    store.end();
});

it('refreshes mixed numeric values and defaults while preserving incomplete input', () => {
    const a = makeNode('frame', 0, 0), b = { ...makeNode('frame', 0, 0), h: 250 };
    const { inputs, content } = fields({ w: '-', h: '100', gap: '5' });
    refreshNumericFields(content, [a, b], inputs.w);
    expect(inputs.w.value).toBe('-');
    expect(inputs.h.value).toBe(''); expect(inputs.h.placeholder).toBe('Mixed');
    expect(inputs.gap.value).toBe('0');
    refreshNumericFields(content, [a, { ...b, h: a.h }], inputs.w);
    expect(inputs.h.value).toBe(String(a.h)); expect(inputs.h.placeholder).toBe('');
    refreshNumericFields(content, [], inputs.w);
    expect(inputs.w.value).toBe('-');
});
