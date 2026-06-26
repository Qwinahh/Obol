// Generate a browser-openable preview of the Obol panel that is genuinely
// reactive: switching profiles swaps the detail section from pre-rendered
// (real-core) variants, so the headline savings and muted rows update live —
// exactly as they do in the extension (which rebuilds authoritatively).
const fs = require("fs");
const path = require("path");
const core = require("../editor/dist/index.js");
const { buildHtml } = require("../editor/render.js");

const u = core.demoUsage();
const PROFS = ["careful", "balanced", "aggressive"];
const SAMPLE_BOARD = {
  configured: true, name: "you", note: "example",
  entries: [
    { rank: 1, name: "tess", displayName: "tess", savedUSD: 184.20, verified: true },
    { rank: 2, name: "you", displayName: "you", savedUSD: 107.10, verified: false },
    { rank: 3, name: "rafa", displayName: "rafa", savedUSD: 88.40, verified: true },
    { rank: 4, name: "kit", displayName: "kit", savedUSD: 51.05, verified: false },
    { rank: 5, name: "dev_n", displayName: "dev_n", savedUSD: 22.90, verified: false },
  ],
};

function detailOf(html) {
  const open = '<div class="detail" id="detail" hidden>';
  const i = html.indexOf(open);
  const j = html.indexOf("<script nonce", i);
  // content sits between the open tag and the last </div> before the script
  const chunk = html.slice(i + open.length, j);
  const k = chunk.lastIndexOf("</div>");
  return chunk.slice(0, k);
}

const variants = {};
for (const id of PROFS) {
  const r = core.buildReport(u, "0.0.1", core.resolveProfile({ id }), core.demoHistory());
  variants[id] = detailOf(buildHtml(r, { demo: true, cspSource: "preview", leaderboard: SAMPLE_BOARD }));
}

// Base page = balanced.
const baseR = core.buildReport(u, "0.0.1", core.resolveProfile({ id: "balanced" }), core.demoHistory());
let html = buildHtml(baseR, { demo: true, cspSource: "preview", shareSvg: core.shareCard(baseR, { handle: "github.com/quin/obol" }), leaderboard: SAMPLE_BOARD, activity: { demo: true, sequence: core.demoActivity(), start: "Watching a sample session\u2026" } });

// Relax CSP for the standalone preview + allow the shim script.
html = html.replace(
  /<meta http-equiv="Content-Security-Policy"[^>]*>/,
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'; font-src data:; img-src data: blob:;" />'
);

// Inject the preview shim immediately after <body>, before the panel script.
const shim = `<script>
  window.__OBOL_VARIANTS__ = ${JSON.stringify(variants)};
  window.acquireVsCodeApi = function(){
    return { postMessage: function(m){ window.__obolMsg && window.__obolMsg(m); }, getState:function(){}, setState:function(){} };
  };
  window.__obolMsg = function(m){
    if (!m) return;
    if (m.cmd === 'profile' && window.__OBOL_VARIANTS__[m.id]) {
      var d = document.getElementById('detail');
      if (d){ d.innerHTML = window.__OBOL_VARIANTS__[m.id];
        d.removeAttribute('hidden');
        var bars = d.querySelectorAll('.fill.grow');
        requestAnimationFrame(function(){ bars.forEach(function(el){ el.style.width = el.style.getPropertyValue('--w')||'0'; }); });
      }
    } else if (m.cmd === 'toggle') {
      var b = document.querySelector('.tgl[data-id="'+m.id+'"]');
      if (b){ var on = b.classList.toggle('on'); b.setAttribute('aria-checked', on ? 'true':'false'); }
    } else if (m.cmd === 'saveCard') {
      var a = document.createElement('a');
      if (m.fmt === 'png') { a.href = m.data; a.download = 'obol-card.png'; }
      else { a.href = URL.createObjectURL(new Blob([m.data], {type:'image/svg+xml'})); a.download = 'obol-card.svg'; }
      document.body.appendChild(a); a.click(); a.remove();
    }
  };
</script>`;
html = html.replace("<body>", "<body>\n" + shim);

const targets = [
  path.join(__dirname, "..", "obol-panel-preview.html"),
  "/sessions/determined-wonderful-meitner/mnt/Obol/obol-panel-preview.html",
];
for (const t of targets) {
  try { fs.writeFileSync(t, html, "utf8"); console.log("wrote", t, "(" + html.length + " bytes)"); }
  catch (e) { console.log("skip", t, e.message); }
}
