export interface Comment {
    id: string;
    thread: string | null;
    x: number;
    y: number;
    node?: string;
    author: string;
    color: string;
    text: string;
    at: number;
    resolved?: boolean;
}
export function validComment(c: Comment): boolean {
    return !!c && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 128
        && (c.thread === null || typeof c.thread === 'string' && c.thread !== c.id)
        && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.at)
        && (c.node === undefined || typeof c.node === 'string')
        && typeof c.author === 'string' && c.author.length <= 32
        && /^#[\da-f]{6}$/i.test(c.color) && typeof c.text === 'string'
        && c.text.trim().length > 0 && c.text.length <= 10000
        && (c.resolved === undefined || typeof c.resolved === 'boolean');
}
