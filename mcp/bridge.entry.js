// Obol MCP App bridge — runs inside the sandboxed iframe.
// Does the ui/initialize handshake so Claude renders the card, matches Claude's
// light/dark theme, and stays INLINE (no pip/fullscreen takeover). The card
// renders from window.OBOL, embedded by the server at resources/read time.
import { App } from "@modelcontextprotocol/ext-apps";

(function () {
  function applyTheme(ctx) {
    try {
      var t = ctx && ctx.theme;
      if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    } catch (e) {}
  }
  function refresh(obol) {
    try { if (obol) { window.OBOL = obol; if (typeof window.__obolApply === "function") window.__obolApply(obol); } } catch (e) {}
  }

  var app;
  try {
    app = new App({ name: "Obol Panel", version: "0.0.1" }, { availableDisplayModes: ["inline"] });
  } catch (e) {
    app = new App({ name: "Obol Panel", version: "0.0.1" });
  }

  app.ontoolresult = function (params) {
    try { var sc = params && params.structuredContent; if (sc && sc.obol) refresh(sc.obol); } catch (e) {}
  };
  if (app.addEventListener) app.addEventListener("hostcontextchanged", function (ctx) { applyTheme(ctx); });

  app.connect().then(function () {
    applyTheme(app.getHostContext && app.getHostContext());
  }).catch(function () { /* not in an MCP host — card still renders from embed */ });
})();
