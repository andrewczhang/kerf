# kerf

A shared design canvas built with TypeScript, Canvas2D and a single Cloudflare Worker. No UI, editor or collaboration libraries. See [DESIGN.md](DESIGN.md) for the architecture and protocol.

## Run

Node 22 or later is recommended.

```sh
npm install
npm run build
npm start
```

Open http://localhost:8787. The root creates a random file URL; share that URL to collaborate. Local Durable Object data lives in `.wrangler/state`. `npm run dev` starts only the Vite client; use Wrangler for multiplayer.

## Controls

- **V** select, **R** rectangle, **O** ellipse, **F** frame, **H** hand
- Drag to create; click creates a 100 × 100 shape. Shift constrains proportions.
- Space + drag or middle-drag pans. Wheel zooms at the pointer; trackpad scroll pans and pinch zooms.
- Shift-click toggles selection; drag empty canvas for marquee selection.
- Eight screen-sized resize handles; Shift preserves aspect ratio, Alt resizes about the center.
- Drag shapes into or out of a frame to reparent them without changing world position.
- Arrow keys nudge, Shift nudges by 10, Delete removes, Ctrl/Cmd+D duplicates.
- Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo. History contains only local transactions and skips properties overwritten remotely.
- The inspector edits live. Click a collaborator's avatar to jump to their view.
- Click the zoom percentage to reset to 100%.
- **C** selects the comment tool; click to pin a thread, Enter posts (Shift+Enter for a newline). Pins follow their attached object. Open a pin to reply, resolve/reopen or delete; Show resolved reveals closed threads. Comments are separate from canvas undo.
- Set a selected object's **Prototype** target in the inspector. **Show links** reveals all orange connections.
- **P** or **Present** opens the selected top-level frame (or first frame). Click linked objects to navigate, click empty areas to reveal hotspots. Left/Right moves between frames, Backspace goes back, Esc exits. Presentation updates live.
- **History** lists shared versions. Save a named milestone, click to preview read-only, then Restore for everyone or Back to current. Restore saves the current document first and clears local undo. Autosaves happen on changed operations at most every ten minutes; the newest 100 autosaves and all named versions are retained.

## Check

```sh
npx tsc --noEmit
npm run build
npm test
npm run test:sync
```

The sync integration script starts its own Wrangler on port 8790, connects three real WebSocket clients, checks creation, movement, presence, late-join state and departure, then stops its server. Port 8787 can remain running independently.

## Extension points

Shared document operations and geometry are pure functions in `src/shared`. Tools implement `Tool` and register in `main.ts`; pen/text can be separate files. Renderer, camera, local history, transport, presence and each UI surface have separate modules. Layers/export can be added as independent UI modules without changing the sync protocol.

## Deployment

`npm run build` builds `dist`; `npx wrangler deploy` deploys the Worker and static assets when a Cloudflare account is configured. The `Room` binding uses a SQLite Durable Object migration. Files are accessible to anyone with their URL; this prototype has no authentication or access controls. Nothing is pushed or deployed by the local setup.
