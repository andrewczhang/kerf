import type { CodeStyle } from './codegen';

export interface CodeElement {
    tag: 'div' | 'fragment';
    attrs: Record<string, string>;
    style: CodeStyle;
    children: CodeElement[];
    line: number;
    col: number;
}
export interface CodeError { error: string; line: number; col: number }
interface Token { kind: 'word' | 'string' | 'number' | 'symbol' | 'eof'; value: string; line: number; col: number }
class SyntaxFailure extends Error {
    constructor(message: string, public line: number, public col: number) { super(message); }
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0, line = 1, col = 1;
    const take = () => { const ch = source[i++]; if (ch === '\n') { line++; col = 1; } else col++; return ch; };
    const fail = (message: string): never => { throw new SyntaxFailure(message, line, col); };
    while (i < source.length) {
        if (/\s/.test(source[i])) { take(); continue; }
        if (source.startsWith('//', i)) { while (i < source.length && source[i] !== '\n') take(); continue; }
        if (source.startsWith('/*', i)) {
            take(); take();
            while (i < source.length && !source.startsWith('*/', i)) take();
            if (i === source.length) fail('unterminated comment');
            take(); take(); continue;
        }
        const start = { line, col };
        const ch = source[i];
        if (ch === '"' || ch === "'") {
            const attribute = tokens.at(-1)?.value === '=';
            const quote = take(); let value = '', closed = false;
            while (i < source.length) {
                const c = take();
                if (c === quote) { closed = true; break; }
                if (!attribute && (c === '\n' || c === '\r')) fail('unterminated string');
                if (attribute || c !== '\\') { value += c; continue; }
                if (i === source.length) fail('unterminated escape');
                const escaped = take();
                if (escaped === 'u') {
                    const hex = source.slice(i, i + 4);
                    if (!/^[\da-f]{4}$/i.test(hex)) fail('expected four hex digits');
                    value += String.fromCharCode(parseInt(hex, 16));
                    for (let j = 0; j < 4; j++) take();
                } else {
                    const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' };
                    if (!(escaped in escapes)) fail('unsupported string escape');
                    value += escapes[escaped];
                }
            }
            if (!closed) fail('unterminated string');
            tokens.push({ kind: 'string', value, ...start }); continue;
        }
        const number = source.slice(i).match(/^-?(?:\d+\.?\d*|\.\d+)/)?.[0];
        if (number) {
            for (const _ of number) take();
            if (!Number.isFinite(Number(number))) fail('number must be finite');
            tokens.push({ kind: 'number', value: number, ...start }); continue;
        }
        const word = source.slice(i).match(/^[a-zA-Z_$][\w$-]*/)?.[0];
        if (word) { for (const _ of word) take(); tokens.push({ kind: 'word', value: word, ...start }); continue; }
        if ('<>=/{}():;,'.includes(ch)) { tokens.push({ kind: 'symbol', value: take(), ...start }); continue; }
        fail(`unexpected '${ch}'`);
    }
    tokens.push({ kind: 'eof', value: '', line, col });
    return tokens;
}

function decodeAttribute(value: string): string {
    return value.replace(/&(amp|lt|gt|quot|#39|#10|#13);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#10;': '\n', '&#13;': '\r' })[entity]!);
}

export function parseJSX(source: string): CodeElement | CodeError {
    try {
        const tokens = tokenize(source); let index = 0;
        const peek = () => tokens[index];
        const fail = (message: string): never => { const t = peek(); throw new SyntaxFailure(message, t.line, t.col); };
        const consume = (value: string) => { if (peek().value !== value) fail(`expected '${value}'`); return tokens[index++]; };
        const kind = (expected: Token['kind']) => { if (peek().kind !== expected) fail(`expected ${expected}`); return tokens[index++]; };
        const element = (): CodeElement => {
            const start = consume('<');
            const node: CodeElement = { tag: 'div', attrs: {}, style: {}, children: [], line: start.line, col: start.col };
            const attributes = new Set<string>();
            if (peek().value === '>') { node.tag = 'fragment'; consume('>'); }
            else {
                consume('div');
                while (peek().value !== '>' && peek().value !== '/') {
                    const key = kind('word').value;
                    if (attributes.has(key) || key in node.attrs) fail(`duplicate attribute '${key}'`);
                    attributes.add(key);
                    consume('=');
                    if (key === 'style') {
                        consume('{'); consume('{');
                        while (peek().value !== '}') {
                            const property = kind('word').value;
                            if (property in node.style) fail(`duplicate style '${property}'`);
                            consume(':');
                            const value = peek();
                            if (value.kind !== 'number' && value.kind !== 'string') fail('expected a string or number');
                            index++;
                            node.style[property] = value.kind === 'number' ? Number(value.value) : value.value;
                            if (peek().value !== '}') consume(',');
                        }
                        consume('}'); consume('}');
                    } else node.attrs[key] = decodeAttribute(kind('string').value);
                }
                if (peek().value === '/') { consume('/'); consume('>'); return node; }
                consume('>');
            }
            while (!(peek().value === '<' && tokens[index + 1]?.value === '/')) {
                if (peek().kind === 'eof') fail(`expected closing ${node.tag === 'fragment' ? 'fragment' : 'div'}`);
                if (peek().value === '{' && tokens[index + 1]?.value === '}') { consume('{'); consume('}'); continue; }
                node.children.push(element());
            }
            consume('<'); consume('/');
            if (node.tag === 'div') consume('div');
            consume('>');
            return node;
        };
        const wrapped = peek().value !== '<';
        if (wrapped) {
            consume('export'); consume('function'); kind('word'); consume('('); consume(')'); consume('{'); consume('return'); consume('(');
        }
        const tree = element();
        if (wrapped) { consume(')'); if (peek().value === ';') consume(';'); consume('}'); }
        if (peek().kind !== 'eof') fail('expected end of code');
        return tree;
    } catch (error) {
        if (error instanceof SyntaxFailure) return { error: error.message, line: error.line, col: error.col };
        throw error;
    }
}
