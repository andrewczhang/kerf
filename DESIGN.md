# Kerf — design

Multiplayer browser design tool, written from scratch. No editor/canvas/design/UI libraries (no React, no Konva/Fabric/Yjs). TypeScript + Vite for the client, one Cloudflare Worker with a Durable Object for sync.

## Layout
```
src/shared/       types + pure logic shared by client and worker
  doc.ts          Node types, Doc = Map<id, Node>, applyOp(doc, op), fractional index helpers
  protocol.ts     ClientMsg / ServerMsg unions
  geometry.ts     Rect, Mat (2D affine), hit-testing helpers
src/client/
  main.ts         boot: read file id from URL (/f/<id>, create random id at /), wire everything
  store.ts        local Doc + pending ops + undo/redo stack; emits change events
  sync.ts         WebSocket client: connect, reconnect with backoff, send ops, reconcile acks
  presence.ts     remote cursors/selections state; throttled (~30Hz) local cursor broadcast
  viewport.ts     pan/zoom camera (screen<->world), wheel zoom at cursor, space/middle-drag pan, trackpad pinch (ctrl+wheel)
  renderer.ts     Canvas2D renderer, devicePixelRatio aware, rAF dirty-flag loop; draws grid dots at zoom, nodes (frames clip children, frame title label), selection outline + 8 handles, marquee, hover outline, remote cursors (arrow + name tag) and remote selections in user color
  draw.ts         shared Canvas2D node drawing for the renderer and PNG export
  export.ts       selection roots/bounds, PNG and SVG export, download helpers
  tools/
    tool.ts       Tool interface {id, cursor, onPointerDown/Move/Up, onKey?}; registry so pen/text can be added as new files
    select.ts     click select, shift toggle, marquee, drag move (multi), 8-handle resize (shift = keep aspect, alt = from center), arrow nudge (shift x10), delete, duplicate (ctrl+d), dragging into/out of frames reparents
    shape.ts      rect / ellipse / frame creation by drag (shift = square), click creates default 100x100
  ui/
    toolbar.ts    tool buttons + shortcuts V R O F, H for hand
    inspector.ts  right panel: X Y W H, rotation not needed, fill color, stroke, corner radius, opacity; multi-select shows mixed
    people.ts     avatars/names of who is in the file, click to jump to their viewport
  style.css
worker/
  index.ts        routes: GET /f/:id/ws -> DO (by idFromName(id)); everything else -> static assets (Workers static assets, SPA fallback to index.html)
  room.ts         Durable Object (SQLite-backed or KV storage API): holds Doc in memory, persists nodes, broadcasts
```
Later features (pen/vector paths, text, layers panel, export) each land as a new tool file / ui file plus new Node type in doc.ts without touching sync.
New node types must add a drawing case in both draw.ts and exportSVG in export.ts.

## Document model
Node = { id, type: 'frame'|'rect'|'ellipse', parent: string|null (null = page root), index: string (fractional index for z-order among siblings), name, x, y, w, h (parent-relative), fill: string (hex), stroke: string|null, strokeWidth, radius, opacity }.
Op = {t:'create', node} | {t:'set', id, key, value} | {t:'delete', id}. Deleting a frame deletes descendants.

Optional layout fields: `layout: 'none'|'horizontal'|'vertical'` (default none), `gap`, `padTop`, `padRight`, `padBottom`, `padLeft` (finite nonnegative numbers, default 0), `justify: 'start'|'center'|'end'|'between'` and `align: 'start'|'center'|'end'` (default start), `sizeW`, `sizeH: 'fixed'|'hug'|'fill'` (default fixed). Absent fields preserve existing documents.

### Auto layout
Only horizontal/vertical frames lay out children, in fractional-index order with parent-relative positions. Shared `applyLayout(doc)` derives geometry directly (never as ops) after document changes on client and server: bottom-up hug sizing, then top-down fill sizing and justify/align placement. Empty hug frames retain their size; hug applies only to auto-layout frames. Fill splits available main-axis space equally or spans the cross axis (minimum 1), but acts fixed when that parent axis hugs; fill outside an auto-layout parent is ignored. Nested frames lay out their children after receiving their fill size.

## Sync (Figma-style property LWW, server authoritative)
- Client applies ops optimistically, sends batches `{type:'ops', ops, seq}`.
- Server applies in arrival order, broadcasts `{type:'ops', ops, from}` to others, acks sender `{type:'ack', seq}`.
- Client keeps pending (id,key) set; incoming remote set for a key with an unacked local write is ignored (local wins until ack) — avoids flicker.
- On connect server sends `{type:'init', nodes, peers, you:{id,color,name}}`; client rebuilds doc then reapplies pending.
- Presence: `{type:'presence', cursor:{x,y}|null, selection:[ids], name, viewport}` relayed, not persisted. Server assigns a color from a fixed palette and a name; peer join/leave messages.
- Persist: DO storage, write-through per op (or debounced), loaded on DO start.
- Drag moves send set ops throttled per frame so others see motion live.

## Visual direction (acz hates stock "AI" look)
Reference: Swiss / International Typographic Style tool UI — think early Figma crossed with a Dieter Rams instrument panel. Light warm-gray app chrome (#e9e8e4) with pure white canvas? No: canvas #f4f3ef, panels #fbfbf9 separated by 1px hairlines (#d6d4ce), no shadows, no rounded cards, no gradients, no emoji, no pills. Type: "Inter Tight" or system-ui sans at 11-12px for UI, tabular numerals in inspector; one signal color: international orange #ff4f00 for selection/handles. Cursor colors from a saturated palette. Wordmark "Kerf" set in bold sans, lowercase, top-left. Toolbar is a thin top bar of icon glyphs drawn as inline SVG strokes.
