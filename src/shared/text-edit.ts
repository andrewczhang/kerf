export function textChange(before: string, after: string) {
    let start = 0, end = before.length, tail = after.length;
    while (start < end && start < tail && before[start] === after[start]) start++;
    while (end > start && tail > start && before[end - 1] === after[tail - 1]) { end--; tail--; }
    return { start, end, insert: after.slice(start, tail) };
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
    // Remove only surviving baseline characters; preserve the peer's replacement.
    return base.slice(0, Math.min(local.start, peer.start))
        + (local.start <= peer.start ? local.insert + peer.insert : peer.insert + local.insert)
        + base.slice(Math.max(local.end, peer.end));
}
