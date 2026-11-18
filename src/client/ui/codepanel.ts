import { componentName, toHTML, toReact } from '../../shared/codegen';
import { parseJSX, type CodeError } from '../../shared/jsxparse';
import { bounds, world } from '../../shared/geometry';
import { children } from '../../shared/doc';
import { codeRoot, codeScopeIds, commitCode, CodeDiffError, diffCode } from '../codesync';
import { download } from '../export';
import type { Store } from '../store';

function highlight(target: HTMLElement, code: string) {
    target.replaceChildren();
    const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|=\s*(?:"[^"]*"|'[^']*')|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|-?(?:\d+\.?\d*|\.\d+)|[a-zA-Z_$][\w$-]*|[^\w\s]/g;
    let end = 0, match: RegExpExecArray | null;
    while ((match = tokens.exec(code))) {
        target.append(document.createTextNode(code.slice(end, match.index)));
        const text = match[0], span = document.createElement('span');
        const before = code.slice(0, match.index), after = code.slice(tokens.lastIndex);
        span.className = text.startsWith('//') || text.startsWith('/*') ? 'syntax-comment'
            : /^(?:=\s*)?["']/.test(text) ? 'syntax-string'
            : /^-?[\d.]/.test(text) ? 'syntax-number'
            : /<\/?\s*$/.test(before) ? 'syntax-tag'
            : /^\s*[=:]/.test(after) ? 'syntax-attr' : 'syntax-punctuation';
        span.textContent = text;
        target.append(span);
        end = tokens.lastIndex;
    }
    target.append(document.createTextNode(code.slice(end) + '\n'));
}

export function codepanel(el: HTMLElement, store: Store) {
    el.innerHTML = '<div class="code-resize" aria-label="Resize code panel" role="separator" aria-orientation="vertical" tabindex="0"></div><div class="code-actions"><button data-code-action="copy">Copy</button><button data-code-action="jsx">Download .jsx</button><button data-code-action="html">Download .html</button><button data-code-action="preview" aria-pressed="false">Preview</button></div><div class="code-editor"><div class="code-gutter" aria-hidden="true"><div></div></div><pre class="code-highlight" aria-hidden="true"></pre><textarea class="code-input" aria-label="React code" spellcheck="false" wrap="off" autocomplete="off" data-1p-ignore data-lpignore="true"></textarea></div><div class="code-error" role="status" aria-live="polite"></div><div class="code-preview" hidden><iframe title="Code preview" sandbox="allow-same-origin"></iframe></div>';
    const aside = el.closest('aside')!;
    const input = el.querySelector<HTMLTextAreaElement>('textarea')!;
    const pre = el.querySelector<HTMLElement>('pre')!;
    const gutter = el.querySelector<HTMLElement>('.code-gutter>div')!;
    const errorLabel = el.querySelector<HTMLElement>('.code-error')!;
    const preview = el.querySelector<HTMLElement>('.code-preview')!;
    const iframe = el.querySelector<HTMLIFrameElement>('iframe')!;
    let active = false, dirty = false, applying = false, timer = 0;
    let rootId: string | null = null, error: CodeError | null = null, panelWidth = 440;
    let baselineIds = new Set<string>();

    const paint = () => {
        highlight(pre, input.value);
        gutter.replaceChildren();
        for (let line = 1; line <= input.value.split('\n').length; line++) {
            const row = document.createElement('div');
            row.textContent = String(line);
            if (line === error?.line) row.className = 'error-line';
            gutter.append(row);
        }
        errorLabel.textContent = error ? `Line ${error.line}, col ${error.col}: ${error.error}` : '';
        input.setAttribute('aria-invalid', String(!!error));
    };
    const scroll = () => { pre.scrollTop = input.scrollTop; pre.scrollLeft = input.scrollLeft; gutter.style.transform = `translateY(${-input.scrollTop}px)`; };
    const showPreview = () => {
        if (preview.hidden) return;
        iframe.srcdoc = toHTML(store.doc, rootId);
        const root = rootId ? store.doc.get(rootId) : undefined;
        const r = root ? { x: 0, y: 0, w: root.w, h: root.h } : bounds(children(store.doc, null).map(n => world(store.doc, n)));
        const w = Math.max(1, r.x + r.w), h = Math.max(1, r.y + r.h);
        const scale = Math.min((preview.clientWidth - 32) / w, (preview.clientHeight - 32) / h, 1);
        iframe.style.width = w + 'px'; iframe.style.height = h + 'px';
        iframe.style.transform = `scale(${Math.max(.01, scale)})`;
    };
    const regenerate = () => {
        if (!active || applying || dirty && document.activeElement === input) return;
        rootId = codeRoot(store.doc, store.selection);
        const start = input.selectionStart, end = input.selectionEnd, top = input.scrollTop, left = input.scrollLeft;
        input.value = toReact(store.doc, rootId);
        baselineIds = codeScopeIds(store.doc, rootId);
        input.setSelectionRange(start, end);
        input.scrollTop = top; input.scrollLeft = left;
        dirty = false; error = null;
        paint(); scroll(); showPreview();
    };
    const apply = () => {
        clearTimeout(timer);
        if (!dirty) return;
        const tree = parseJSX(input.value);
        if ('error' in tree) { error = tree; paint(); return; }
        try {
            const ops = diffCode(store.doc, rootId, tree, baselineIds);
            applying = true;
            commitCode(store, ops);
            applying = false; dirty = false; error = null;
            regenerate();
        } catch (failure) {
            applying = false;
            error = { error: failure instanceof Error ? failure.message : 'Unable to apply code', line: failure instanceof CodeDiffError ? failure.line : 1, col: failure instanceof CodeDiffError ? failure.col : 1 };
            paint();
        }
    };
    const edited = () => {
        dirty = true; error = null; paint(); scroll();
        clearTimeout(timer); timer = window.setTimeout(apply, 250);
    };
    input.oninput = edited;
    input.onscroll = scroll;
    input.onblur = () => { apply(); if (!error) regenerate(); };
    input.onkeydown = event => {
        if (event.key === 'Tab') { event.preventDefault(); input.setRangeText('  ', input.selectionStart, input.selectionEnd, 'end'); edited(); }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !dirty) {
            event.preventDefault(); store.history(event.shiftKey);
        }
    };
    const button = (action: string) => el.querySelector<HTMLButtonElement>(`[data-code-action="${action}"]`)!;
    button('copy').onclick = () => {
        void navigator.clipboard.writeText(input.value).catch(() => { errorLabel.textContent = 'Clipboard unavailable'; });
    };
    button('jsx').onclick = () => download(new Blob([input.value], { type: 'text/jsx' }), componentName(rootId ? store.doc.get(rootId)?.name ?? 'Canvas' : 'Canvas') + '.jsx');
    button('html').onclick = () => download(new Blob([toHTML(store.doc, rootId)], { type: 'text/html' }), componentName(rootId ? store.doc.get(rootId)?.name ?? 'Canvas' : 'Canvas') + '.html');
    button('preview').onclick = () => {
        preview.hidden = !preview.hidden;
        button('preview').setAttribute('aria-pressed', String(!preview.hidden));
        showPreview();
    };
    const resize = el.querySelector<HTMLElement>('.code-resize')!;
    let drag: { x: number; width: number } | null = null;
    const width = (value: number) => { panelWidth = Math.max(360, Math.min(window.innerWidth * .75, value)); aside.style.width = panelWidth + 'px'; showPreview(); };
    resize.onpointerdown = event => { drag = { x: event.clientX, width: aside.getBoundingClientRect().width }; resize.setPointerCapture(event.pointerId); event.preventDefault(); };
    resize.onpointermove = event => { if (drag) width(drag.width + drag.x - event.clientX); };
    resize.onpointerup = resize.onpointercancel = () => { drag = null; };
    resize.onkeydown = event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); width(panelWidth + (event.key === 'ArrowLeft' ? 16 : -16)); } };
    new ResizeObserver(showPreview).observe(preview);
    store.addEventListener('change', regenerate);
    return {
        activate(value: boolean) {
            active = value; el.hidden = !active;
            aside.classList.toggle('code-open', active);
            aside.style.width = active ? panelWidth + 'px' : '';
            if (active) regenerate();
        },
    };
}
