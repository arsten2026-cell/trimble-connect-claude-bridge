# Claude bridge for Trimble Connect (Arsten)

A Trimble Connect **3D-viewer extension**. It relays commands from a local MCP server
(running on the user's PC at `127.0.0.1:47800`) to the Trimble Connect Workspace API, so Claude can select, hide,
isolate and colour objects in the 3D viewer.

- Manifest: `https://arsten2026-cell.github.io/trimble-connect-claude-bridge/manifest.json`
- Install: Trimble Connect project → Settings → Apps & Capabilities → + Add Custom → paste the manifest URL.

These are static files with no secrets. The page talks only to Trimble Connect (its parent window) and to the
localhost bridge window the user opens.
