export function textChange(before: string, after: string) {
    let start = 0, end = before.length, tail = after.length;
    while (start < end && start < tail && before[start] === after[start]) start++;
    while (end > start && tail > start && before[end - 1] === after[tail - 1]) { end--; tail--; }
    return { start, end, insert: after.slice(start, tail) };
}

type Span = ReturnType<typeof textChange>;
type Match = [number, number];

function subsequence(shorter: string, longer: string): Match[] | undefined {
    const matches: Match[] = [];
    for (let i = 0, j = 0; j < longer.length && i < shorter.length; j++)
        if (shorter[i] === longer[j]) matches.push([i++, j]);
    return matches.length === shorter.length ? matches : undefined;
}

function matchingCharacters(before: string, after: string): Match[] | undefined {
    if (before.length <= after.length) {
        const insertions = subsequence(before, after);
        if (insertions) return insertions;
    } else {
        const deletions = subsequence(after, before);
        if (deletions) return deletions.map(([j, i]) => [i, j]);
    }
    // Bound the work for large unrelated replacements.
    const width = after.length + 1, cells = (before.length + 1) * width;
    if (cells > 1_000_000) return;
    const lengths = new Uint16Array(cells);
    for (let i = before.length - 1; i >= 0; i--)
        for (let j = after.length - 1; j >= 0; j--) {
            const at = i * width + j;
            lengths[at] = before[i] === after[j] ? lengths[at + width + 1] + 1 : Math.max(lengths[at + width], lengths[at + 1]);
        }
    const matches: Match[] = [];
    for (let i = 0, j = 0; i < before.length && j < after.length;) {
        if (before[i] === after[j]) matches.push([i++, j++]);
        else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i++;
        else j++;
    }
    return matches;
}

function changedSpans(base: string, span: Span): Span[] {
    const { start, end, insert } = span;
    if (start === end || !insert) return [span];
    const removed = base.slice(start, end), matches = matchingCharacters(removed, insert);
    if (!matches?.length) return [span];
    const spans: Span[] = [];
    let old = 0, next = 0;
    for (const [i, j] of [...matches, [removed.length, insert.length]]) {
        if (i !== old || j !== next) spans.push({ start: start + old, end: start + i, insert: insert.slice(next, j) });
        old = i + 1; next = j + 1;
    }
    return spans;
}

export function mergeText(base: string, value: string, current: string): string {
    if (current === base || current === value) return value;
    if (value === base) return current;
    const local = textChange(base, value), peer = textChange(base, current);
    if (local.start >= peer.end) {
        const offset = peer.insert.length - (peer.end - peer.start);
        return current.slice(0, local.start + offset) + local.insert + current.slice(local.end + offset);
    }
    if (local.end <= peer.start)
        return current.slice(0, local.start) + local.insert + current.slice(local.end);
    const spans = [...changedSpans(base, peer), ...changedSpans(base, local)]
        .sort((a, b) => a.start - b.start || Number(b.start === b.end) - Number(a.start === a.end));
    let offset = 0, result = '';
    for (const span of spans) {
        if (span.start > offset) result += base.slice(offset, span.start);
        result += span.insert;
        offset = Math.max(offset, span.end);
    }
    return result + base.slice(offset);
}
