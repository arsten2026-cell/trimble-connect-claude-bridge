// Arsten Claude bridge, the Trimble Connect 3D-viewer extension panel.
// Relays RPC calls coming from the local MCP server (through the localhost popup window)
// to the Workspace API. Chrome blocks this iframe from reaching localhost directly
// (Local Network Access isn't passed to extension iframes), hence the popup.
(() => {
  "use strict";
  const BRIDGE_ORIGIN = "http://127.0.0.1:47800";
  const BRIDGE_URL = BRIDGE_ORIGIN + "/bridge";
  const POPUP_NAME = "arsten-claude-bridge";

  // Only these Workspace API methods can be called remotely. Nothing destructive to project data.
  const ALLOWED = new Set([
    "viewer.getModels", "viewer.getLoadedModel", "viewer.getObjects", "viewer.getObjectProperties",
    "viewer.getSelection", "viewer.setSelection", "viewer.setObjectState", "viewer.isolateEntities",
    "viewer.getColoredObjects", "viewer.convertToObjectIds", "viewer.convertToObjectRuntimeIds",
    "viewer.toggleModel", "viewer.getLayers", "viewer.setLayersVisibility",
    "viewer.getCamera", "viewer.setCamera", "viewer.getCameraMode", "viewer.setCameraMode",
    "viewer.addSectionPlane", "viewer.removeSectionPlanes", "viewer.getSectionPlanes",
    "viewer.addSectionBox", "viewer.removeSectionBox",
    "viewer.getSnapshot", "viewer.reset", "viewer.getObjectBoundingBoxes", "viewer.getObjectPositions",
    "viewer.getHierarchyParents", "viewer.getHierarchyChildren",
    "viewer.getPsetDefinitions", "viewer.getEntities", "viewer.getSettings", "viewer.setSettings",
    "viewer.getPresentation",
    "view.getViews", "view.getView", "view.getCurrentView", "view.selectView", "view.createView", "view.updateView",
    "project.getProject", "project.getCurrentProject", "project.getSettings", "project.getMembers",
    "user.getUser", "user.getSettings",
  ]);

  const $ = (id) => document.getElementById(id);
  const logEl = $("log");
  function log(msg) {
    const t = new Date().toLocaleTimeString();
    logEl.textContent = `${t}  ${msg}\n` + logEl.textContent.slice(0, 8000);
  }
  function setStatus(which, state, text) {
    $("d" + which).className = "dot " + state;
    $("t" + which).textContent = text;
  }

  let api = null;
  let popup = null;          // WindowProxy of the localhost bridge window
  let lastSeen = 0;          // last message from the popup
  let tokenWaiters = [];

  function onEvent(event, data) {
    if (event === "extension.accessToken") {
      const w = tokenWaiters; tokenWaiters = [];
      w.forEach((f) => f(data));
      return;
    }
    if (event === "viewer.onSelectionChanged" || event === "viewer.onModelStateChanged" ||
        event === "project.onChanged" || event === "viewer.onModelReset") {
      send({ type: "event", name: event, data: event === "viewer.onSelectionChanged" ? summariseSelection(data) : data });
    }
  }
  function summariseSelection(data) {
    try {
      const sel = data && (data.data || data);
      if (!Array.isArray(sel)) return null;
      return sel.map((m) => ({ modelId: m.modelId, count: (m.objectRuntimeIds || []).length }));
    } catch { return null; }
  }

  async function getAccessToken() {
    const p = new Promise((resolve, reject) => {
      tokenWaiters.push(resolve);
      setTimeout(() => reject(new Error("Timed out waiting for the access token")), 60000);
    });
    const immediate = await api.extension.requestPermission("accesstoken");
    if (immediate && immediate !== "pending" && immediate !== "denied") return immediate;
    if (immediate === "denied") throw new Error("User denied access token permission");
    return p;
  }

  async function handleRpc(method, params) {
    if (!api) throw new Error("Not connected to Trimble Connect yet");
    switch (method) {
      case "ping":
        return { ok: true, host: api.extension && api.extension.host || null };
      case "token":
        return await getAccessToken();
      case "call": {
        const path = String(params && params.path || "");
        if (!ALLOWED.has(path)) throw new Error("Method not allowed by the extension: " + path);
        const [ns, fn] = path.split(".");
        const target = api[ns];
        if (!target || typeof target[fn] !== "function") throw new Error("Not available in this Connect version: " + path);
        const args = Array.isArray(params.args) ? params.args : [];
        return await target[fn](...args);
      }
      default:
        throw new Error("Unknown method " + method);
    }
  }

  function send(msg) {
    if (!popup || popup.closed) return false;
    try { popup.postMessage(msg, BRIDGE_ORIGIN); return true; } catch { return false; }
  }

  window.addEventListener("message", async (e) => {
    if (e.origin !== BRIDGE_ORIGIN) return;           // only the localhost bridge window
    const m = e.data || {};
    popup = e.source;
    lastSeen = Date.now();
    if (m.type === "bridge-hello" || m.type === "bridge-status") {
      send({ type: m.type === "bridge-hello" ? "panel-hello" : "panel-alive" });
      setStatus("Bridge", m.mcp ? "ok" : "wait", m.mcp ? "Claude connected" : "Bridge window open, waiting for the MCP server…");
      return;
    }
    if (m.type === "rpc") {
      const short = m.method === "call" ? (m.params && m.params.path) : m.method;
      try {
        const result = await handleRpc(m.method, m.params);
        send({ type: "rpc-result", id: m.id, result });
        if (m.method !== "ping") log("✓ " + short);
      } catch (err) {
        const msg = (err && (err.message || err.toString())) || String(err);
        send({ type: "rpc-error", id: m.id, error: msg });
        log("✗ " + short + ": " + msg);
      }
    }
  });

  setInterval(() => {
    if (popup && (popup.closed || Date.now() - lastSeen > 10000)) {
      setStatus("Bridge", "bad", popup.closed ? "Bridge window closed. Click Connect Claude." : "Bridge window not responding");
      if (popup.closed) popup = null;
    }
  }, 3000);

  $("btnConnect").addEventListener("click", () => {
    const w = window.open(BRIDGE_URL, POPUP_NAME, "popup=yes,width=380,height=260");
    if (!w) { setStatus("Bridge", "bad", "Popup blocked. Allow popups for this site."); return; }
    popup = w; lastSeen = Date.now();
    setStatus("Bridge", "wait", "Opening bridge window…");
  });
  $("btnClear").addEventListener("click", () => { logEl.textContent = ""; });

  if (window.parent === window) {
    setStatus("Connect", "bad", "Not inside Trimble Connect. Add this extension to a project and open it from the 3D viewer side panel.");
    $("btnConnect").disabled = true;
    return;
  }
  TrimbleConnectWorkspace.connect(window.parent, onEvent, 30000).then(async (a) => {
    api = a;
    let where = "Trimble Connect";
    try { const p = await api.project.getProject(); if (p && p.name) where = p.name; } catch {}
    setStatus("Connect", "ok", "Connected to " + where);
    log("Workspace API connected");
  }).catch((err) => {
    setStatus("Connect", "bad", "Not inside Trimble Connect (" + (err && err.message || err) + ")");
  });
})();
