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
- **T** then click to place text. Double-click text or press **Enter** on a selected text layer to edit; **Esc** or clicking away finishes.
- Set font, size, weight, alignment and wrapping in Typography. Auto hugs the text; Fixed wraps at the W value in Layout.
- Space + drag or middle-drag pans. Wheel zooms at the pointer; trackpad scroll pans and pinch zooms.
- Shift-click toggles selection; drag empty canvas for marquee selection.
- Layers lists the live document tree: click to select, double-click names to rename, use the eye/lock buttons, and drag rows to reorder or nest in frames/groups.
- Ctrl/Cmd+G groups selection; Ctrl/Cmd+Shift+G ungroups. Click a grouped shape to select its group, double-click to select inside. Hidden/locked layers are excluded from canvas interaction.
- Eight screen-sized resize handles; Shift preserves aspect ratio, Alt resizes about the center.
- Drag shapes into or out of a frame to reparent them without changing world position.
- **Shift+A** adds auto layout to a frame or wraps the selection. Drag children to reorder at the orange insertion line; drag fully outside to leave the stack.
- The inspector offers Fixed/Hug/Fill sizing. Resizing with handles switches the resized axes to Fixed; auto-layout frames show dashed padding guides when selected.
- Arrow keys nudge, Shift nudges by 10, Delete removes, Ctrl/Cmd+D duplicates. Alt/Option-drag duplicates in place and moves the copies; press or release Alt/Option during a move to toggle copying. Alt/Option-click alone does not duplicate.
- Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo. History contains only local transactions and skips properties overwritten remotely.
- The inspector edits live. Click a collaborator's avatar to jump to their view.
- Click the zoom percentage to reset to 100%.
- Fill lists run topmost first. Use + to stack paints; click a swatch to edit solid, linear, radial or image paints. Eye toggles visibility; − removes a paint.
- Gradient strips add stops on click. Drag square stops, edit their color/opacity/position, or Delete a selected stop (minimum two). Drag the on-canvas gradient endpoints for a single selected object; Angle and Reverse adjust the gradient.
- Effects + adds a drop shadow. Expand an effect to edit its settings or switch to inner shadow, layer blur or background blur.
- Paste an image to add a top paint to the selected object, or create a centered image when nothing is selected. Drop image files on the canvas to create image rectangles; image paints also have an Upload button and Fill/Fit/Tile modes. Upload progress and errors appear in the footer.
- **C** selects the comment tool; click to pin a thread, Enter posts (Shift+Enter for a newline). Pins follow their attached object. Open a pin to reply, resolve/reopen or delete; Show resolved reveals closed threads. Comments are separate from canvas undo.
- Set a selected object's **Prototype** target in the inspector. **Show links** reveals all orange connections.
- **P** or **Present** opens the selected top-level frame (or first frame). Click linked objects to navigate, click empty areas to reveal hotspots. Left/Right moves between frames, Backspace goes back, Esc exits. Presentation updates live.
- **History** lists shared versions. Save a named milestone, click to preview read-only, then Restore for everyone or Back to current. Restore saves the current document first and clears local undo. Autosaves happen on changed operations at most every ten minutes; the newest 100 autosaves and all named versions are retained.
- Object/pixel snapping is always on; hold Ctrl/Cmd during a drag to bypass it. Moving also snaps to equal gaps between neighbors or extends a row/column's spacing. Orange guides and gap labels appear while moving/resizing/creating. Alt-hover measures the selection to a node (or its parent frame on empty canvas).
- Shift+R toggles rulers; drag from a ruler to create a local guide, drag a guide to move it or back onto a ruler to delete it. Rulers and grid preferences persist locally; ruler guides are local to each file.
- “Snap to grid” in the footer or Ctrl/Cmd+' toggles the 8px grid. Selection size is shown below its bounds.

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
