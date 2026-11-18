import { expect, it } from 'vitest';
import { applyOp, makeNode } from '../src/shared/doc';
import { topLevelFrames } from '../src/shared/pages';
import { presentationFrames } from '../src/client/ui/presentation';

it('orders presentation targets by page index and then frame index rather than insertion order', () => {
    const a = { ...makeNode('page', 0, 0, 'A'), id: 'a' }, b = { ...a, index: 'B', id: 'b' };
    const earlyA = { ...makeNode('frame', 0, 0, 'A'), parent: a.id, id: 'early-a' }, lateA = { ...earlyA, index: 'B', id: 'late-a' };
    const earlyB = { ...earlyA, parent: b.id, id: 'early-b' }, lateB = { ...earlyB, index: 'B', id: 'late-b' };
    const doc = new Map([b, lateB, a, lateA, earlyB, earlyA].map(n => [n.id, n]));
    expect(topLevelFrames(doc).map(n => n.id)).toEqual(['early-a', 'late-a', 'early-b', 'late-b']);
    expect(presentationFrames(doc).map(n => n.id)).toEqual(['early-a', 'late-a', 'early-b', 'late-b']);
    applyOp(doc, { t: 'set', id: lateA.id, key: 'index', value: '0' });
    expect(presentationFrames(doc).map(n => n.id)).toEqual(['late-a', 'early-a', 'early-b', 'late-b']);
    applyOp(doc, { t: 'set', id: b.id, key: 'index', value: '0' });
    expect(presentationFrames(doc).map(n => n.id)).toEqual(['early-b', 'late-b', 'late-a', 'early-a']);
});
it('orders legacy root frames by index and excludes nested or non-frame targets', () => {
    const early = { ...makeNode('frame', 0, 0, 'A'), id: 'early' }, late = { ...early, index: 'B', id: 'late' };
    const nested = { ...early, parent: early.id, id: 'nested' }, rect = makeNode('rect', 0, 0);
    expect(topLevelFrames(new Map([late, nested, rect, early].map(n => [n.id, n]))).map(n => n.id)).toEqual(['early', 'late']);
    expect(topLevelFrames(new Map())).toEqual([]);
});
