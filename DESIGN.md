# Kerf — design

Multiplayer browser design tool, written from scratch. No editor/canvas/design/UI libraries (no React, no Konva/Fabric/Yjs). TypeScript + Vite for the client, one Cloudflare Worker with a Durable Object for sync.

## Layout
Canvas overlays include 20px top/left rulers, local ruler guides, smart alignment guides, gap measurements and selection size labels. Snapping/measurement math lives in `shared/snap.ts`; `client/snapping.ts` bridges tools and `client/guides.ts` owns overlays, ruler interaction and local preferences. Signal labels are square orange rectangles with small white tabular numerals.
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
    pen.ts        P: click corner, drag bezier handles (alt breaks, shift 45°), click first anchor to close, Enter/Esc to finish; on a selected path (double-click or Enter) drag anchors/handles, click a segment to insert, double-click an anchor to toggle smooth, Delete removes the anchor, click an end anchor to keep drawing
  ui/
    toolbar.ts    tool buttons + shortcuts V R O F, H for hand
    inspector.ts  right panel: X Y W H, rotation not needed, fill color, stroke, corner radius, opacity; multi-select shows mixed
    people.ts     avatars/names of who is in the file, click to jump to their viewport
  style.css
worker/
  index.ts        routes: GET /f/:id/ws -> DO (by idFromName(id)); everything else -> static assets (Workers static assets, SPA fallback to index.html)
  room.ts         Durable Object (SQLite-backed or KV storage API): holds Doc in memory, persists nodes, broadcasts
```
The left layers panel renders the live tree, with rename, visibility, lock and drag reordering. Pure group/reparent/bounds operations live in shared/layers.ts. Later features (pen/vector paths, text, export) land without touching sync.
New node types must add a drawing case in both draw.ts and exportSVG in export.ts.

## Document model
Node = { id, type: 'frame'|'rect'|'ellipse'|'group'|'text'|'path', parent: string|null (null = page root), index: string (fractional index for z-order among siblings), name, x, y, w, h (parent-relative), fill: string (hex), stroke: string|null, strokeWidth, radius, opacity, hidden, locked }. Path nodes add points: {x,y,ix,iy,ox,oy}[] (anchor plus in/out bezier handles, normalized 0..1 to the node box so resize and move just work) and closed: boolean; geometry lives in shared/path.ts and pen.ts edits it by rewriting points plus the fitted box.
Frames and groups may parent nodes. Groups have no fill or clip; their bounds are the union of children, normalized without changing world positions. Missing hidden/locked flags in old documents normalize to false.
Op = {t:'create', node} | {t:'set', id, key, value} | {t:'delete', id}. Deleting a frame deletes descendants.

Nodes optionally carry `fills: Paint[]` (maximum 12, bottom to top) and `effects: Effect[]` (maximum 8). Missing fills fall back to the legacy `fill`; empty fills draw nothing. Paints are solid (hex6 color), linear/radial (2–16 color/opacity stops sorted on use, normalized from/to coordinates −2…3), or image (SHA-256 asset hash, intrinsic w/h, fill=cover / fit=contain / tile). Every paint has opacity 0…1 and visibility. Radial from is the center; distance to to in normalized space is the radius, yielding an ellipse in a non-square box. Fill UI edits also update legacy fill from the topmost visible solid or gradient's first stop.

Effects are drop-shadow/inner-shadow (x/y, nonnegative blur, spread, hex6 color, opacity, visibility) or layer-blur/background-blur (nonnegative radius, visibility). Effect dimensions are world units. The canvas renderer applies drop shadows, background blur, paints, stroke and inner shadows; layer blur composites the node through an offscreen canvas. Frames clip children.

`PUT /f/:id/assets/:hash` accepts PNG/JPEG/WebP/GIF bytes up to 1.5 MiB, verifies SHA-256 and stores `{type,bytes}` under `asset:<hash>` in the room Durable Object. `GET` serves those bytes with immutable one-year caching. Client uploads decode and downscale to a longest side of 2048px, retain transparent PNG when it fits, otherwise encode WebP (.86 quality) with JPEG fallback. Canvas image insertion caps the initial longest side at 800 world units.

Paint/effect UI lives in `ui/fills.ts` and `ui/effects.ts`; editing state and legacy-fill writes in `paint-edit.ts`, canvas controls in `gradient-handles.ts`, clipboard/drop handling in `image-import.ts`. UI transactions write whole arrays through Store; no sync protocol changes are needed.

Canvas and PNG export share `draw.ts`; PNG waits for image assets to decode and pads output bounds for drop shadows and layer blur. SVG preserves stacked paints, embeds image bytes in data URIs, and uses clipped images/patterns for cover, contain and tile placement. `exportSVGWithAssets` resolves assets asynchronously; `exportSVG` is the synchronous serializer with an optional resolved image map. Missing assets fail export rather than falling back to a color. SVG filters implement drop/inner shadows, spread and layer/background blur. Background blur replays earlier visible content through internal references, clipped to the node interior; both formats sample only exported content underneath, not unselected page content. Open paths omit inner shadows and background blur.

## Sync (Figma-style property LWW, server authoritative)
- Client applies ops optimistically, sends batches `{type:'ops', ops, seq}`.
- Server applies in arrival order, broadcasts `{type:'ops', ops, from}` to others, acks sender `{type:'ack', seq}`.
- Client keeps pending (id,key) set; incoming remote set for a key with an unacked local write is ignored (local wins until ack) — avoids flicker.
- On connect server sends `{type:'init', nodes, peers, you:{id,color,name}}`; client rebuilds doc then reapplies pending.
- Presence: `{type:'presence', cursor:{x,y}|null, selection:[ids], name, viewport}` relayed, not persisted. Server assigns a color from a fixed palette and a name; peer join/leave messages.
- Persist: DO storage, write-through per op (or debounced), loaded on DO start.
- Drag moves send set ops throttled per frame so others see motion live.

## Prototype, comments and versions
Prototype links are optional node properties. `draw.ts` shares Canvas2D drawing between editor and presentation. Presentation isolates the current top-level frame, with live navigation and ancestor hotspots. Comments are independent records (`comments` storage), with node-relative pins and no undo entries. `worker/features.ts` owns thread validation and version storage (`versions`, `version:<id>`). Restore broadcasts a minimal shared op diff, saves a safety snapshot first and clears client undo/pending state. History previews use a separate renderer document without mutating the live store. New surfaces retain flat hairline panels and the single orange navigation signal.

## Visual direction (acz hates stock "AI" look)
Reference: Swiss / International Typographic Style tool UI — think early Figma crossed with a Dieter Rams instrument panel. Light warm-gray app chrome (#e9e8e4) with pure white canvas? No: canvas #f4f3ef, panels #fbfbf9 separated by 1px hairlines (#d6d4ce), no shadows, no rounded cards, no gradients, no emoji, no pills. Type: "Inter Tight" or system-ui sans at 11-12px for UI, tabular numerals in inspector; one signal color: international orange #ff4f00 for selection/handles. Cursor colors from a saturated palette. Wordmark "Kerf" set in bold sans, lowercase, top-left. Toolbar is a thin top bar of icon glyphs drawn as inline SVG strokes.
