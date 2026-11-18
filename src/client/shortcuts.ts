export function isViewerCanvasShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>, interactive: boolean) {
    return !interactive && !e.ctrlKey && !e.metaKey && !e.altKey && ['v', 'h', 'c', 'Escape', ' '].includes(e.key);
}
