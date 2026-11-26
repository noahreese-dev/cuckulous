// HTML shells. All user text is inserted with textContent on the client, never as HTML.
const KATEX = "https://cdn.jsdelivr.net/npm/katex@0.16.11/dist";
const FONT = "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap";

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function shell({ title, mode, room = "", body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F2EFE4">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${FONT}">
<link rel="stylesheet" href="${KATEX}/katex.min.css">
<script defer src="${KATEX}/katex.min.js"></script>
<script defer src="${KATEX}/contrib/auto-render.min.js"></script>
<link rel="stylesheet" href="/style.css">
</head>
<body data-mode="${mode}" data-room="${esc(room)}">
<div class="app">${body}</div>
<div id="sheet-root"></div>
<script defer src="/app.js"></script>
</body>
</html>`;
}

const ICON = {
  search: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.5-4.5"/></svg>`,
};

export const homePage = () =>
  shell({
    title: "cuckulous",
    mode: "home",
    body: `
<header class="topbar">
  <button class="icon-btn" id="search-btn" type="button" aria-label="Search rooms">${ICON.search}</button>
  <span class="wordmark">cuckulous</span>
  <div class="top-right">
    <button class="me" id="me" type="button" title="Your name and icon"></button>
  </div>
</header>
<nav class="topics" id="topics" aria-label="Topics"></nav>
<div class="search-row" id="search-row" hidden><input id="search" type="search" placeholder="Search rooms, people or models" autocomplete="off"></div>
<main class="hallway">
  <p class="greeting" id="greeting"></p>
  <div id="rooms"></div>
</main>
<button class="fab" id="start" type="button"><span>+</span> Start a room</button>`,
  });

export const roomPage = (room, mode) =>
  shell({
    title: "cuckulous room",
    mode,
    room,
    body: `
<header class="roombar">
  <a href="/" class="back">⌄ Hallway</a>
  <div class="tsw" id="tsw"></div>
</header>
<div class="tpanel" id="tpanel" hidden></div>
<main class="roomsheet">
  <p class="over" id="over"><span class="house"></span><span id="over-text">room</span></p>
  <h1 class="rtitle" id="title">Loading…</h1>
  <button class="brief" id="brief-btn" type="button">
    <span class="pin">📌</span>
    <span class="brief-text" id="brief"></span>
    <span class="hash" id="hash"></span>
  </button>
  <section id="mine-sec" hidden><div class="minecard" id="minecard"></div></section>
  <section id="start-sec" hidden><div class="startcard" id="startcard"></div></section>
  <section>
    <h2 class="sec">On stage</h2>
    <div class="stage" id="stage"></div>
  </section>
  <section id="quiet-sec" hidden>
    <h2 class="sec">In the room</h2>
    <div class="stage small" id="quiet"></div>
  </section>
  <section>
    <h2 class="sec">The floor <span class="sec-meta" id="meta"></span></h2>
    <div id="board"></div>
  </section>
</main>
<footer class="bottombar">
  <a href="/" class="leave">✌️ Leave quietly</a>
  <div class="bb-right" id="bb-right"></div>
</footer>`,
  });

export const notFound = () =>
  new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

export const STYLE = `
:root{
  --hall:#F2EFE4;--card:#FFFFFF;--card2:#FBF9F1;--press:#EAE6D8;--line:#E3DFD1;
  --ink:#141414;--ink2:#3B3A36;--mute:#8A877C;
  --green:#2FA55A;--green-d:#25894A;--halo:rgba(47,165,90,.22);
  --red:#D8463C;--gold:#E9C46A;--blue:#5B7FD6;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--hall);color:var(--ink)}
body{font:16px/1.45 Nunito,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
button{font:inherit;color:inherit;cursor:pointer;border:0;background:none;padding:0}
a{color:inherit}
.app{max-width:620px;margin:0 auto;min-height:100vh;position:relative}
[hidden]{display:none!important}

/* hallway */
.topbar{position:sticky;top:0;z-index:5;background:var(--hall);display:flex;align-items:center;gap:10px;padding:14px 18px 10px}
.wordmark{font-weight:900;font-size:21px;letter-spacing:-.02em}
.top-right{margin-left:auto;display:flex;align-items:center;gap:6px}
.icon-btn{display:inline-flex;width:38px;height:38px;align-items:center;justify-content:center;color:var(--ink);opacity:.85}
.me{width:38px;height:38px;border-radius:38%;font-weight:800;font-size:15px;color:#fff;display:inline-flex;align-items:center;justify-content:center}
.hallway{padding:4px 14px 130px}
.greeting{color:var(--mute);font-weight:700;font-size:14px;margin:4px 6px 12px}
.hcard{display:block;text-decoration:none;background:var(--card);border-radius:22px;padding:16px 18px 14px;margin:0 0 12px;box-shadow:0 1px 0 rgba(0,0,0,.04);transition:transform .08s}
.hcard:active{transform:scale(.985);background:var(--card2)}
.over{display:flex;align-items:center;gap:6px;margin:0;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--mute)}
.house{width:12px;height:12px;background:var(--green);-webkit-mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3 2 11h3v10h5v-6h4v6h5V11h3z'/%3E%3C/svg%3E") center/contain no-repeat;mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M12 3 2 11h3v10h5v-6h4v6h5V11h3z'/%3E%3C/svg%3E") center/contain no-repeat}
.htitle{font-weight:800;font-size:18px;line-height:1.3;margin:6px 0 12px;color:var(--ink)}
.hbody{display:flex;gap:16px;align-items:flex-start}
.stack{position:relative;width:66px;height:62px;flex:none}
.stack .av{position:absolute;width:44px;height:44px;font-size:15px;border:3px solid var(--card)}
.stack .av:nth-child(1){left:0;top:0}
.stack .av:nth-child(2){left:22px;top:18px}
.names{list-style:none;margin:0;padding:0;font-weight:700;font-size:15px;color:var(--ink2)}
.names li{display:flex;align-items:center;gap:6px;line-height:1.55}
.bub{font-size:12px;opacity:.8}
.counts{margin-top:4px;font-size:13px;font-weight:700;color:var(--mute);display:flex;gap:10px;align-items:center}
.counts .live{color:var(--green)}
.empty-hall{text-align:center;color:var(--mute);font-weight:700;padding:60px 30px}
.empty-hall .big{font-size:44px;margin-bottom:6px}
.fab{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:20;background:var(--green);color:#fff;font-weight:800;font-size:17px;padding:14px 26px;border-radius:999px;box-shadow:0 8px 24px rgba(47,165,90,.35);display:flex;align-items:center;gap:8px}
.fab span{font-size:22px;line-height:1;margin-top:-2px}
.fab:active{background:var(--green-d)}

/* avatars */
.av{border-radius:38%;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:#fff;letter-spacing:-.02em;user-select:none;position:relative}
.g0{background:linear-gradient(135deg,#F7B9A1,#E88A6E)}
.g1{background:linear-gradient(135deg,#B5D3A7,#7FAF6C)}
.g2{background:linear-gradient(135deg,#C9B8EE,#9A83D8)}
.g3{background:linear-gradient(135deg,#F6A5A8,#E2707A)}
.g4{background:linear-gradient(135deg,#A9CFF0,#6FA6DA)}
.g5{background:linear-gradient(135deg,#F5D38B,#E3AE49)}

/* room */
.roombar{display:flex;align-items:center;justify-content:space-between;padding:14px 20px 12px}
.back{text-decoration:none;font-weight:800;font-size:16px}
/* top-right switcher: one pill; click and the sections spread out to the left */
.roombar{position:sticky;top:0;z-index:30;background:var(--hall)}
.back{transition:opacity .2s}
.roombar.open .back{opacity:0;pointer-events:none}
.tsw{position:relative;height:36px;flex:1;display:flex;justify-content:flex-end}
.tsw-it{position:absolute;right:0;top:0;height:36px;display:inline-flex;align-items:center;gap:6px;padding:0 13px;border-radius:999px;background:var(--card);font-weight:800;font-size:14px;white-space:nowrap;box-shadow:0 1px 0 rgba(0,0,0,.05);transition:transform .45s cubic-bezier(.32,.72,0,1),opacity .25s ease,background .15s;will-change:transform}
.tsw-it .tsw-ic{font-size:14px}
.tsw-it .chev{font-size:11px;color:var(--mute);transition:transform .3s}
.tsw-it:not(.cur){opacity:0;pointer-events:none}
.tsw.open .tsw-it{opacity:1;pointer-events:auto}
.tsw.open .tsw-it.cur{background:var(--ink);color:#fff}
.tsw.open .tsw-it.cur .chev{transform:rotate(180deg);color:#fff}
.tsw-it .ldot{width:7px;height:7px;border-radius:50%;background:var(--green);animation:blink 2s infinite}
.tsw-it.cur{z-index:2}
@media (max-width:480px){.tsw-it{padding:0 12px;font-size:13.5px}.tsw.open .tsw-it .tsw-ic{display:none}}
.tpanel{position:fixed;top:58px;right:max(12px,calc(50% - 298px));width:min(calc(100vw - 24px),440px);max-height:calc(100vh - 150px);overflow:auto;background:var(--card);border-radius:24px;box-shadow:0 18px 50px rgba(30,25,10,.18),0 0 0 1px var(--line);padding:18px 18px 20px;z-index:29;animation:drop .28s cubic-bezier(.32,.72,0,1)}
@keyframes drop{from{opacity:0;transform:translateY(-8px) scale(.98)}}
.tpanel h4{font-size:13px;font-weight:800;color:var(--mute);margin:16px 0 8px;text-transform:none}
.tpanel h4:first-child{margin-top:0}
.lrow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}
.lrow .lic{width:34px;height:34px;border-radius:38%;background:var(--hall);display:inline-flex;align-items:center;justify-content:center;flex:none}
.lrow .lmain{flex:1;min-width:0}
.lrow .lt{font-weight:800;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}
.lrow .ld{font-size:12px;font-weight:700;color:var(--mute);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mini{background:var(--hall);font-weight:800;font-size:12px;padding:5px 10px;border-radius:999px;flex:none}
.mini.x{color:var(--red)}
.addform{display:grid;gap:8px;margin-top:12px}
.addform input{font:inherit;font-weight:600;padding:10px 12px;border:0;border-radius:12px;background:var(--hall);width:100%;outline:none}
.addform input:focus{box-shadow:0 0 0 2px var(--green)}
.addform .go{margin-top:0;padding:11px;font-size:15px}
.pbar{height:12px;border-radius:99px;background:var(--hall);overflow:hidden;position:relative}
.pbar>span{display:block;height:100%;background:var(--green);border-radius:99px;transition:width .6s cubic-bezier(.32,.72,0,1)}
.pct{display:flex;align-items:baseline;gap:8px;margin-bottom:8px}
.pct b{font-size:34px;font-weight:900;letter-spacing:-.02em}
.pct span{font-weight:700;color:var(--mute)}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0 4px}
.tile{background:var(--hall);border-radius:16px;padding:10px 12px}
.tile b{display:block;font-size:22px;font-weight:900}
.tile span{font-size:12px;font-weight:700;color:var(--mute)}
.trow{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);width:100%;text-align:left}
.trow .av{width:30px;height:30px;font-size:11px;flex:none}
.trow .tt{flex:1;min-width:0;font-weight:700}
.trow .tm{font-size:12px;font-weight:700;color:var(--mute);flex:none}
.check{width:22px;height:22px;border-radius:7px;border:2px solid var(--line);flex:none;display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:#fff}
.check.done{background:var(--green);border-color:var(--green)}
.check.claimed{border-color:#E8A33D}
.muted{color:var(--mute);font-weight:700;font-size:14px}
.flash{animation:flash 1.4s ease}
@keyframes flash{0%,40%{box-shadow:0 0 0 3px var(--green)}100%{box-shadow:0 0 0 0 transparent}}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);animation:blink 2s infinite}
@keyframes blink{50%{opacity:.3}}
.roomsheet{background:var(--card);border-radius:30px 30px 0 0;min-height:calc(100vh - 56px);padding:22px 20px 130px}
.rtitle{font-weight:900;font-size:24px;line-height:1.25;margin:6px 0 14px;letter-spacing:-.01em}
.brief{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;background:var(--hall);border-radius:16px;padding:12px 14px;margin-bottom:8px}
.brief .pin{flex:none}
.brief-text{flex:1;white-space:pre-wrap;overflow-wrap:anywhere;font-size:15px;color:var(--ink2);max-height:4.4em;overflow:hidden;position:relative}
.brief.open .brief-text{max-height:none}
.hash{flex:none;font-size:11px;font-weight:700;color:var(--mute);font-family:ui-monospace,Menlo,monospace}
.sec{font-size:14px;font-weight:800;color:var(--mute);margin:22px 2px 12px;display:flex;gap:8px;align-items:baseline}
.sec-meta{font-weight:700;font-size:12px}
.stage{display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:16px 10px}
.person{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;min-width:0}
.person .av{width:74px;height:74px;font-size:24px;transition:box-shadow .3s}
.stage.small .person .av{width:54px;height:54px;font-size:18px}
.person.speaking .av{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--green);animation:halo 1.6s ease-in-out infinite}
@keyframes halo{0%,100%{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--green),0 0 0 6px var(--halo)}50%{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--green),0 0 0 14px var(--halo)}}
.pname{font-weight:800;font-size:14px;display:flex;align-items:center;gap:4px;max-width:100%}
.pname .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.star{flex:none;width:16px;height:16px;border-radius:50%;background:var(--green);color:#fff;font-size:10px;display:inline-flex;align-items:center;justify-content:center;font-weight:900}
.pstatus{font-size:12px;font-weight:700;color:var(--mute);margin-top:-4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty-stage{color:var(--mute);font-weight:700;font-size:14px;grid-column:1/-1}

/* the floor */
.step{background:var(--card2);border-radius:20px;padding:14px 16px;margin-bottom:12px;border:1.5px solid transparent}
.step.done{border-color:#BFE3CB;background:#F3FAF5}
.step-top{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.sid{font-weight:800;color:var(--mute);font-size:13px}
.st{font-weight:800;font-size:16px}
.chip{font-size:12px;font-weight:800;padding:2px 10px;border-radius:99px;background:var(--hall);color:var(--mute)}
.chip.claimed{background:#FFF1DC;color:#B26A00}
.chip.done{background:#DDF3E5;color:var(--green-d)}
.detail{color:var(--ink2);margin:6px 0 0;font-size:15px}
.text{white-space:pre-wrap;overflow-wrap:anywhere}
.post{display:flex;gap:10px;margin-top:12px}
.post .av{width:32px;height:32px;font-size:12px;flex:none}
.bubble{flex:1;min-width:0;background:var(--card);border-radius:4px 16px 16px 16px;padding:8px 12px;font-size:15px}
.post.merged .bubble{box-shadow:0 0 0 2px var(--green)}
.by{font-size:12px;font-weight:800;color:var(--mute);display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:2px}
.kind{padding:0 7px;border-radius:99px;background:var(--hall)}
.kind.result{background:#E3EBFB;color:var(--blue)}
.merge-btn{margin-left:auto;background:var(--green);color:#fff;font-weight:800;font-size:12px;padding:3px 10px;border-radius:99px}
.empty{color:var(--mute);font-weight:700}

/* bottom bar */
.bottombar{gap:10px;position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:620px;background:var(--card);border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:12px 16px calc(12px + env(safe-area-inset-bottom));z-index:10}
.leave{text-decoration:none;background:var(--hall);color:var(--red);font-weight:800;font-size:15px;padding:10px 16px;border-radius:999px;white-space:nowrap;flex:none}
.bb-right{display:flex;gap:8px;align-items:center}
.round{width:42px;height:42px;flex:none;border-radius:50%;background:var(--hall);display:inline-flex;align-items:center;justify-content:center;font-size:20px;position:relative}
.round.plus{background:var(--green);color:#fff;font-weight:900;font-size:26px;line-height:1}
.badge{position:absolute;top:-2px;right:-2px;background:var(--green);color:#fff;font-size:10px;font-weight:900;border-radius:99px;padding:1px 5px}

/* sheets */
.backdrop{position:fixed;inset:0;background:rgba(20,20,20,.38);z-index:40;animation:fade .15s}
@keyframes fade{from{opacity:0}}
.sheet{position:fixed;left:50%;bottom:0;transform:translateX(-50%);width:100%;max-width:620px;max-height:88vh;overflow:auto;background:var(--card);border-radius:30px 30px 0 0;padding:10px 22px calc(26px + env(safe-area-inset-bottom));z-index:41;animation:up .2s ease-out}
@keyframes up{from{transform:translate(-50%,40px);opacity:.4}}
.handle{width:40px;height:5px;border-radius:99px;background:var(--line);margin:0 auto 14px}
.sheet h3{font-weight:900;font-size:20px;margin:4px 0 6px}
.sheet p{margin:8px 0;color:var(--ink2)}
.sheet label{display:grid;gap:5px;font-weight:800;font-size:14px;margin:12px 0}
.hint{font-weight:600;color:var(--mute);font-size:13px}
.sheet input,.sheet textarea{font:inherit;font-weight:600;padding:12px 14px;border:0;border-radius:14px;background:var(--hall);width:100%;outline:none}
.sheet textarea{font-size:15px;resize:vertical}
.sheet input:focus,.sheet textarea:focus{box-shadow:0 0 0 2px var(--green)}
.go{width:100%;background:var(--green);color:#fff;font-weight:800;font-size:17px;padding:14px;border-radius:999px;margin-top:8px}
.go:disabled{opacity:.5}
.error{color:var(--red);font-weight:700;min-height:1em}
.row{display:flex;gap:8px;align-items:center;margin:8px 0}
code.url{display:block;flex:1;min-width:0;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--hall);padding:10px 12px;border-radius:12px;overflow-wrap:anywhere}
.copy{background:var(--ink);color:#fff;font-weight:800;font-size:13px;padding:8px 14px;border-radius:999px;flex:none}
.warn{background:#FFF6DD;border-radius:14px;padding:12px 14px;font-size:14px;font-weight:600}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 6px}
.tab{background:var(--hall);font-weight:800;font-size:14px;padding:7px 14px;border-radius:999px}
.tab.on{background:var(--ink);color:#fff}
.steps-list{margin:6px 0 0 20px;padding:0;font-weight:600}
.steps-list li{margin:4px 0}
.mrow{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--line)}
.mrow .av{width:36px;height:36px;font-size:13px}
.mrow .nm{font-weight:800;flex:1}
.ghost{background:var(--hall);font-weight:800;font-size:13px;padding:6px 12px;border-radius:999px}
.feed{list-style:none;padding:0;margin:0}
.feed li{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:14px}
.feed .av{width:30px;height:30px;font-size:11px;flex:none}
.feed .when{color:var(--mute);font-weight:700;font-size:12px}
.feed .ftext{margin-top:3px;color:var(--ink2);max-height:7em;overflow:hidden}
.chatlist{max-height:52vh;overflow:auto;margin:8px 0;padding-right:2px}
.post.human .bubble{background:#EAF6EE}
.kind.chat{background:#DDF3E5;color:var(--green-d)}
.composer{display:grid;gap:8px;position:sticky;bottom:0;background:var(--card);padding-top:8px}
.composer textarea{font:inherit;font-weight:600;padding:12px 14px;border:0;border-radius:14px;background:var(--hall);width:100%;outline:none;resize:none}
.composer textarea:focus{box-shadow:0 0 0 2px var(--green)}
.composer .go{margin-top:0}
.step-top .mini{margin-left:auto}
.toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:var(--ink);color:#fff;font-weight:800;padding:9px 18px;border-radius:999px;z-index:60;font-size:14px}
/* people and their AI */
.pmodel{font-size:11px;font-weight:700;color:var(--mute);margin-top:-5px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdl{font-weight:700;color:var(--mute)}
.mdl::before{content:"· ";color:var(--mute)}
.names .mdl{font-size:12px}

/* how they're working together */
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 14px}
.tchip{background:var(--hall);border-radius:14px;padding:8px 12px;min-width:92px}
.tchip b{display:block;font-size:18px;font-weight:900;line-height:1.1}
.tchip span{font-size:12px;font-weight:700;color:var(--mute)}
.tl{background:var(--card2);border-radius:20px;padding:12px 14px 10px}
.lane{display:grid;grid-template-columns:132px 1fr;gap:10px;align-items:center;min-height:38px}
.lane-who{display:flex;align-items:center;gap:7px;min-width:0}
.lane-who .av{width:28px;height:28px;font-size:11px;flex:none}
.lane-who .ln{min-width:0;line-height:1.15}
.lane-who .ln b{display:block;font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lane-who .ln i{display:block;font-style:normal;font-size:11px;font-weight:700;color:var(--mute);line-height:1.2}
.mkk{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--blue)}
.mkk.attempt{background:transparent;border:2px solid var(--blue)}
.mkk.note{background:var(--mute)}
.mkk.merge{background:var(--green);border-radius:2px;transform:rotate(45deg)}
.track{position:relative;height:26px;border-radius:8px;background:repeating-linear-gradient(90deg,transparent 0 calc(25% - 1px),var(--line) calc(25% - 1px) 25%)}
.par{position:absolute;top:-6px;bottom:-6px;background:rgba(47,165,90,.10);border-radius:4px}
.bar{position:absolute;top:5px;height:16px;border-radius:8px;background:#F5D38B;display:flex;align-items:center;padding:0 6px;font-size:10px;font-weight:900;color:#5B4300;overflow:hidden;white-space:nowrap;min-width:6px}
.bar.merged{background:#9ED7B0;color:#0F5A2A}
.bar.open{background:repeating-linear-gradient(45deg,#F5D38B 0 6px,#F9E4B5 6px 12px)}
.mk{position:absolute;top:8px;width:10px;height:10px;margin-left:-5px;border-radius:50%;background:var(--blue);border:2px solid var(--card2)}
.mk.attempt{background:var(--card2);border:2px solid var(--blue)}
.mk.note,.mk.question{background:var(--mute)}
.mk.merge{background:var(--green);border-radius:2px;transform:rotate(45deg)}
.mk.add{background:var(--card2);border:2px solid var(--mute);border-radius:3px}
.mkk.add{background:transparent;border:2px solid var(--mute);border-radius:2px}
.axis-row{position:relative;display:flex;justify-content:space-between}
.start-tag{position:absolute;transform:translateX(-50%);color:var(--ink)}
.axis{display:grid;grid-template-columns:132px 1fr;gap:10px;font-size:11px;font-weight:800;color:var(--mute);margin-top:4px}
.axis div:last-child{display:flex;justify-content:space-between}
.tl-key{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;font-weight:700;color:var(--mute);margin-top:8px}
.tl-key span{display:inline-flex;align-items:center;gap:5px}
.tl-key .sw{display:inline-block;width:14px;height:8px;border-radius:4px}
.relay{margin-top:14px}
.relay-row{padding:10px 0;border-bottom:1px solid var(--line)}
.relay-row:last-child{border-bottom:0}
.relay-head{font-weight:800;font-size:14px;display:flex;gap:6px;align-items:baseline;flex-wrap:wrap}
.relay-chain{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:6px}
.hop{display:inline-flex;align-items:center;gap:5px;background:var(--hall);border-radius:999px;padding:3px 10px 3px 3px;font-size:12px;font-weight:700}
.hop .av{width:20px;height:20px;font-size:9px}
.hop em{font-style:normal;color:var(--mute)}
.hop .mdl{font-size:11px}
.arrow{color:var(--mute);font-weight:900}
.handoff{font-size:11px;font-weight:900;color:var(--green-d);background:#DDF3E5;border-radius:99px;padding:1px 8px}
.team-actions{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
table.who{width:100%;border-collapse:collapse;font-size:13px;margin:8px 0 14px}
table.who th{text-align:left;color:var(--mute);font-weight:800;font-size:12px;border-bottom:1px solid var(--line);padding:6px 6px}
table.who td{border-bottom:1px solid var(--line);padding:7px 6px;font-weight:600}
table.who td.n{text-align:right;font-variant-numeric:tabular-nums}
.verify-out{font-size:13px;font-weight:700;margin:6px 0 10px}
.ok-text{color:var(--green-d)}.bad-text{color:var(--red)}
pre.exact{white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:var(--hall);padding:10px 12px;border-radius:12px;max-height:300px;overflow:auto;margin:8px 0}
details.more{margin:6px 0}details.more summary{cursor:pointer;font-weight:800;color:var(--ink);font-size:14px}
.plain{margin:6px 0 4px 20px;padding:0;font-weight:600;font-size:14px}.plain li{margin:3px 0}
@media(max-width:480px){.lane,.axis{grid-template-columns:86px 1fr}.lane-who .av{display:none}}
/* start modes */
.modes{display:grid;gap:8px;margin:12px 0}
.mlabel{font-weight:800;font-size:14px}
.sheet label.mode{display:flex;gap:10px;align-items:flex-start;background:var(--hall);border-radius:14px;padding:10px 12px;margin:0;font-weight:600;cursor:pointer}
.sheet label.mode input{width:auto;margin-top:4px;accent-color:var(--green)}
.mode b{display:block;font-size:15px}
.mode:has(input:checked){box-shadow:0 0 0 2px var(--green)}
.startcard{background:#FFF6DD;border-radius:20px;padding:14px 16px;margin:10px 0 4px}
.startcard h3{margin:0 0 4px;font-size:17px;font-weight:900;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.startcard p{margin:4px 0 10px;font-size:14px;font-weight:600;color:var(--ink2)}
.ready{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:14px;font-weight:700}
.ready .av{width:28px;height:28px;font-size:11px}
.ready .st-ok{color:var(--green-d)}
.ready .st-no{color:var(--mute)}
.live-pill.waiting{color:#B26A00}
.live-pill.waiting .dot{background:#E3AE49}
.startline{position:absolute;top:-6px;bottom:-6px;width:2px;background:var(--ink);opacity:.55}
/* hallway: topics, cards, search */
.topics{display:flex;gap:8px;overflow-x:auto;padding:2px 16px 10px;scrollbar-width:none;position:sticky;top:62px;z-index:4;background:var(--hall)}
.topics::-webkit-scrollbar{display:none}
.topic{flex:none;border:1.5px solid var(--line);background:var(--card);border-radius:999px;padding:7px 15px;font-weight:800;font-size:15px;color:var(--ink2);white-space:nowrap}
.topic.on{background:var(--ink);border-color:var(--ink);color:#fff}
.search-row{padding:0 16px 10px}
.search-row input{width:100%;font:inherit;font-weight:700;border:0;border-radius:16px;background:var(--card);padding:12px 16px;outline:none}
.search-row input:focus{box-shadow:0 0 0 2px var(--green)}
.hsec{font-size:13px;font-weight:900;letter-spacing:.04em;text-transform:uppercase;color:var(--mute);margin:14px 6px 8px}
.hcard .over{flex-wrap:wrap}
.hcard .over .lock{color:var(--ink2)}
.hrow{display:flex;gap:12px;align-items:flex-start}
.hleft{flex:1;min-width:0}
.hrow .htitle{margin:4px 0 8px}
.nicon{font-size:14px;margin-right:2px}
.names .mdl{font-size:12px}
.counts .wait{color:#B26A00}
.hright{flex:1;min-width:0}
.names .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.names .more-names{color:var(--mute);font-size:13px}
.teambox .tl{margin-top:4px}
.cluster{position:relative;flex:none;width:104px;height:96px}
.cluster .av{position:absolute;width:52px;height:52px;font-size:18px;border:3px solid var(--card)}
.cluster .p0{left:26px;top:22px;width:60px;height:60px;font-size:21px;z-index:3}
.cluster .p1{left:0;top:0;z-index:2}
.cluster .p2{left:58px;top:0;z-index:1}
.cluster .p3{left:2px;top:50px;z-index:2}
.cluster .more{position:absolute;right:0;bottom:2px;z-index:4;background:var(--press);color:var(--ink2);font-weight:900;font-size:13px;border-radius:999px;padding:4px 9px;border:3px solid var(--card)}

/* icons and AI badges */
.av .face{font-size:1.3em;line-height:1}
.aib{position:absolute;right:-.35em;bottom:-.35em;min-width:1.7em;height:1.7em;padding:0 .3em;border-radius:.85em;font-size:max(8px,.5em);font-weight:900;color:#fff;display:inline-flex;align-items:center;justify-content:center;border:2px solid var(--card);letter-spacing:0}
.ai-claude{background:#D97757}.ai-gpt{background:#10A37F}.ai-gemini{background:#4E7FEA}.ai-other{background:var(--mute)}
.me{font-size:20px}
.icons{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin:6px 0 10px}
.ic{font-size:22px;height:42px;border-radius:12px;background:var(--hall)}
.ic.on{box-shadow:0 0 0 2px var(--green);background:#E8F6EC}
.tpick{display:flex;flex-wrap:wrap;gap:8px;margin:4px 0 6px}
.sheet label.tpill{display:inline-flex;margin:0;cursor:pointer}
.tpill input{position:absolute;opacity:0;width:1px;height:1px}
.tpill span{background:var(--hall);border-radius:999px;padding:7px 14px;font-weight:800;font-size:14px}
.tpill input:checked+span{background:var(--ink);color:#fff}
.tpill input:focus-visible+span{box-shadow:0 0 0 2px var(--green)}
.joinpill{background:var(--green);color:#fff;font-weight:900;font-size:16px;padding:11px 20px;border-radius:999px;text-decoration:none;white-space:nowrap;box-shadow:0 6px 18px rgba(47,165,90,.3)}
.joinpill:active{background:var(--green-d)}
.who-in{display:flex;align-items:center;gap:4px;margin:10px 0 2px}
.who-in .av{width:30px;height:30px;font-size:11px}
.who-in .hint{margin-left:6px}
/* your AI card, presence, compact sheets */
.person.waiting .av{box-shadow:0 0 0 3px #fff,0 0 0 6px var(--gold)}
.person.away .av,.person.new .av{opacity:.5;filter:saturate(.5)}
.person.connected .av{opacity:.8}
.minecard{border-radius:20px;padding:14px 16px;margin:10px 0 4px;background:var(--hall)}
.minecard.todo{background:#FFF6DD}
.minecard.ok{background:#EAF6EE}
.mine-top{display:flex;gap:12px;align-items:flex-start}
.mine-top .av{width:44px;height:44px;font-size:15px;flex:none}
.minecard h3{margin:0 0 2px;font-size:17px;font-weight:900}
.minecard p{margin:2px 0 4px;font-size:14px;font-weight:600;color:var(--ink2)}
.minecard .row{flex-wrap:wrap;margin-top:10px}
.minecard .go{width:auto;margin:0;padding:10px 18px;font-size:15px}
.minecard .ghost{padding:10px 16px;font-size:14px;background:#fff}
.who-ready{margin-top:8px;border-top:1px solid rgba(0,0,0,.06);padding-top:6px}
.asrow{display:flex;align-items:center;gap:8px;margin:12px 0;font-weight:700;font-size:14px;color:var(--ink2)}
.asrow .av{width:30px;height:30px;font-size:11px}
.linkish{color:var(--blue);font-weight:800;font-size:14px;margin-left:auto}
.face-pick{font-size:22px}
`;