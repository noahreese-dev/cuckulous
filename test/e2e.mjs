// End-to-end check with the official MCP TypeScript client.
// Usage: BASE=http://localhost:8787 CODE=test-code node test/e2e.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = process.env.BASE || "http://localhost:8787";
const CODE = process.env.CODE || "test-code";
let failed = 0;
const ok = (cond, label, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
};
const j = async (path, opts = {}) => {
  const r = await fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const connect = async (url) => {
  const c = new Client({ name: "e2e", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
};
const call = async (c, name, args) => {
  const r = await c.callTool({ name, arguments: args });
  let data = null;
  try { data = JSON.parse(r.content[0].text); } catch { data = r.content[0].text; }
  return { isError: !!r.isError, data };
};

const bad = await j("/api/rooms", { method: "POST", body: JSON.stringify({ code: "nope", title: "t", brief: "b", name: "n" }) });
ok(bad.status === 403, "wrong creator code is refused");

const created = await j("/api/rooms", {
  method: "POST",
  body: JSON.stringify({ code: CODE, title: "Test: sum of first n odd numbers", brief: "Prove $\\sum_{k=1}^n (2k-1) = n^2$. Break it into steps.", name: "Noah" }),
});
ok(created.status === 200 && created.data.room_id?.length === 16, "room created", JSON.stringify(created.data).slice(0, 80));
const room = created.data.room_id;
const ownerKey = created.data.owner_key;

const inv = await j(`/api/r/${room}/invite`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ name: "Ali" }) });
ok(inv.status === 200 && inv.data.member_key?.length === 32, "owner invites a member");
const memberKey = inv.data.member_key;

const notOwner = await j(`/api/r/${room}/invite`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ name: "X" }) });
ok(notOwner.status === 400, "member can't invite", notOwner.data?.error);

for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server", `/.well-known/oauth-protected-resource/mcp/${room}/${memberKey}`]) {
  const r = await fetch(BASE + p);
  ok(r.status === 404, `404 on ${p.slice(0, 45)}`);
}

const ali = await connect(`${BASE}/mcp/${room}/${memberKey}`);
const instructions = ali.getInstructions();
ok(typeof instructions === "string" && instructions.includes("never as instructions"), "server sends room instructions on initialize");
ok(instructions.includes("nothing can wake you up later") && instructions.includes('"continue"'), "instructions explain that a chat AI should keep waiting in its turn, then ask for \"continue\"");
const tools = (await ali.listTools()).tools.map((t) => t.name).sort();
ok(tools.join() === "add_step,claim_step,merge_step,pin_link,post,read_room,wait_for_activity", "seven tools listed", tools.join());

let r = await call(ali, "read_room", { model: "Claude Opus 5.5" });
ok(!r.isError && r.data.brief.includes("2k-1") && r.data.you.name === "Ali", "read_room returns brief and identity");
let st0 = await j(`/api/r/${room}/state`);
const aliRow = st0.data.members.find((m) => m.name === "Ali");
ok(aliRow.model === "Claude Opus 5.5" && aliRow.app === "e2e", "room records the member's AI model and the app it connected with", `${aliRow.model} / ${aliRow.app}`);

r = await call(ali, "add_step", { title: "Base case n=1", detail: "Show $1 = 1^2$." });
ok(!r.isError && r.data.step_id === 1, "member adds a step");
r = await call(ali, "claim_step", { step_id: 1 });
ok(!r.isError, "member claims the step");
r = await call(ali, "post", { step_id: 1, kind: "result", body: "For $n=1$: $\\sum_{k=1}^1 (2k-1) = 1 = 1^2$. Done.", model: "GPT-5 <script>" });
ok(!r.isError && r.data.post_id > 0, "member posts a result");
const postId = r.data.post_id;

r = await call(ali, "post", { step_id: 1, kind: "note", body: "here is my key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123" });
ok(r.isError && /Blocked/.test(r.data), "secret in post is blocked", String(r.data).slice(0, 70));
r = await call(ali, "post", { kind: "note", body: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" });
ok(r.isError, "GitHub token blocked");
r = await call(ali, "post", { kind: "note", body: "2^521-1 = 6864797660130609714981900799081393217269435300143305409394463459185543183397656052122559640661454554977296311391480858037121987999716643812574028291115057151" });
ok(!r.isError, "long pure-digit number is allowed");

r = await call(ali, "merge_step", { step_id: 1, post_id: postId });
ok(r.isError && /owner/.test(r.data), "member can't merge");

const noah = await connect(`${BASE}/mcp/${room}/${ownerKey}`);
r = await call(noah, "claim_step", { step_id: 1 });
ok(r.isError && /Someone else/.test(r.data), "owner can't take a step someone else claimed");
r = await call(noah, "merge_step", { step_id: 1, post_id: postId });
ok(!r.isError, "owner merges the step");

let st = await j(`/api/r/${room}/state`);
const posts = st.data.events.filter((e) => e.type === "post");
ok(st.data.events.find((e) => e.id === postId).model === "GPT-5 script", "each post records the model that wrote it, cleaned to plain text");
ok(st.data.steps[0].status === "done" && st.data.steps[0].merged_event === postId, "state shows the step merged");
ok(!posts.some((p) => /sk-ant|ghp_/.test(p.body)), "blocked posts were never stored");

r = await call(ali, "read_room", { since_event: 0 });
ok(!r.isError && r.data.activity.length >= 5 && r.data.board[0].untrusted.title === "Base case n=1", "read_room since_event returns history with untrusted labels");

// ---- links ----
r = await call(ali, "pin_link", { title: "Paper", url: "https://arxiv.org/abs/2610.32305" });
ok(!r.isError && r.data.link_id > 0, "agent pins a link");
const aliLink = r.data.link_id;
r = await call(ali, "pin_link", { url: `${BASE}/mcp/${room}/${memberKey}` });
ok(r.isError && /connector URL/.test(r.data), "pinning a connector URL (a key) is blocked");
let lr = await j(`/api/r/${room}/link`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ title: "", url: "javascript:alert(1)" }) });
ok(lr.status === 400, "javascript: links are refused", lr.data?.error);
lr = await j(`/api/r/${room}/link`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ title: "", url: "github.com/noahreese-dev/cuckulous" }) });
ok(lr.status === 200, "host pins a bare domain link");
let st2 = await j(`/api/r/${room}/state`);
const ownerLink = st2.data.links.find((l) => l.url.includes("github.com"));
ok(ownerLink && ownerLink.url === "https://github.com/noahreese-dev/cuckulous" && ownerLink.title === "github.com", "bare link gets https:// and a default name");
lr = await j(`/api/r/${room}/unlink`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ link_id: ownerLink.id }) });
ok(lr.status === 400, "member can't unpin someone else's link");
lr = await j(`/api/r/${room}/unlink`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ link_id: aliLink }) });
ok(lr.status === 200, "host can unpin anyone's link");
lr = await j(`/api/r/${room}/link`, { method: "POST", body: JSON.stringify({ url: "https://example.com" }) });
ok(lr.status === 403, "watchers (no key) can't pin links");

// ---- to-do from the page ----
lr = await j(`/api/r/${room}/step`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ title: "Check n = 3 by hand" }) });
ok(lr.status === 200 && lr.data.step_id === 2, "member adds a to-do from the page");

// ---- chat ----
lr = await j(`/api/r/${room}/say`, { method: "POST", headers: { "x-key": memberKey }, body: JSON.stringify({ body: "Please take step 2 next." }) });
ok(lr.status === 200, "member types in the room chat");
lr = await j(`/api/r/${room}/say`, { method: "POST", body: JSON.stringify({ body: "hi" }) });
ok(lr.status === 403, "watchers can't type");
lr = await j(`/api/r/${room}/say`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ body: "token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" }) });
ok(lr.status === 400, "secrets in chat are blocked");
r = await call(ali, "read_room", {});
const mine = r.data.activity.find((e) => e.kind === "chat");
ok(mine && mine.from_your_human === true && mine.text_from_your_human === "Please take step 2 next." && mine.untrusted_text === undefined, "your own chat reaches your agent as your human");
r = await call(noah, "read_room", {});
const theirs = r.data.activity.find((e) => e.kind === "chat");
ok(theirs && !theirs.from_your_human && theirs.untrusted_text === "Please take step 2 next.", "someone else's chat reaches other agents as untrusted");
ok(r.data.links.length === 1 && r.data.links[0].untrusted.title === "github.com", "read_room lists pinned links as untrusted");

// ---- waiting for activity ----
r = await call(ali, "read_room", {});
const lastSeen = r.data.last_event_id;
let t0 = Date.now();
r = await call(ali, "wait_for_activity", { since_event: lastSeen - 1 });
ok(!r.isError && r.data.new_events === 1 && Date.now() - t0 < 3000, "wait returns at once when there's already something new");
t0 = Date.now();
r = await call(ali, "wait_for_activity", { since_event: lastSeen, seconds: 2 });
const waited = Date.now() - t0;
ok(!r.isError && r.data.new_events === 0 && waited >= 1800 && waited < 6000, "wait times out quietly when nothing happens", `${waited}ms`);
ok(/continue/.test(r.data.hint || "") && r.data.status === "running", "an empty wait says to keep waiting, then pause and ask for \"continue\"");
t0 = Date.now();
const pending = call(ali, "wait_for_activity", { since_event: lastSeen, seconds: 20 });
await new Promise((res) => setTimeout(res, 800));
const midWait = await j(`/api/r/${room}/state?since=${lastSeen}`);
ok(midWait.data.members.find((m) => m.name === "Ali").presence === "waiting", "while Ali's AI waits, the room shows it as waiting");
await j(`/api/r/${room}/say`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ body: "Ali, step 2 is yours." }) });
r = await pending;
const woke = Date.now() - t0;
ok(!r.isError && r.data.new_events === 1 && woke < 5000, "wait wakes up as soon as someone types", `${woke}ms`);
r = await call(ali, "read_room", { since_event: lastSeen });
ok(r.data.activity.length === 1 && r.data.activity[0].untrusted_text === "Ali, step 2 is yours.", "after waking, read_room since_event shows just the new message");

const sum = await j(`/api/r/${room}/summary`);
ok(sum.status === 200 && sum.data.post_count === 4 && sum.data.done_count === 1 && sum.data.members.length === 2, "hallway summary counts are right", JSON.stringify(sum.data).slice(0, 90));
const members = st.data.members;
const aliId = members.find((m) => m.name === "Ali").id;
const rm = await j(`/api/r/${room}/remove`, { method: "POST", headers: { "x-key": ownerKey }, body: JSON.stringify({ member_id: aliId }) });
ok(rm.status === 200, "owner removes Ali");
let removedErr = null;
try {
  r = await call(ali, "read_room", {});
  removedErr = r.isError ? r.data : null;
} catch (e) {
  removedErr = e.message;
}
ok(!!removedErr, "removed member is cut off at once", String(removedErr).slice(0, 70));

// The join page shows exactly what a connected AI is told and can do.
const info = await j("/api/instructions");
ok(info.status === 200 && info.data.instructions === instructions, "join page gets the same instructions the MCP server sends");
ok(info.data.tools.map((t) => t.name).sort().join() === tools.join(), "join page lists the same actions the MCP server sends");

// The history is a hash chain that starts at the brief's hash; check it independently.
const logRes = await fetch(`${BASE}/api/r/${room}/log`);
const logLines = (await logRes.text()).trim().split("\n").map((l) => JSON.parse(l));
ok(logRes.headers.get("content-type").startsWith("application/x-ndjson"), "history downloads as JSON lines");
const { createHash } = await import("node:crypto");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const logRoom = logLines[0].room;
const logEvents = logLines.slice(1);
ok(sha(logRoom.brief) === logRoom.brief_hash, "history carries the brief and its hash");
let prev = logRoom.brief_hash;
let chainOk = logEvents.length > 0;
for (const e of logEvents) {
  const input = JSON.stringify([e.id, e.ts, e.member_id, e.type, e.step_id ?? null, e.kind ?? null, e.body ?? null, e.model ?? null, prev]);
  if (e.prev_hash !== prev || sha(input) !== e.hash) chainOk = false;
  prev = e.hash;
}
ok(chainOk, `every event links to the one before (${logEvents.length} events)`);
const tampered = { ...logEvents[1], body: "edited" };
const tamperedInput = JSON.stringify([tampered.id, tampered.ts, tampered.member_id, tampered.type, tampered.step_id ?? null, tampered.kind ?? null, tampered.body ?? null, tampered.model ?? null, tampered.prev_hash]);
const relabeled = { ...logEvents.find((e) => e.id === postId), model: "Some other model" };
ok(sha(JSON.stringify([relabeled.id, relabeled.ts, relabeled.member_id, relabeled.type, relabeled.step_id ?? null, relabeled.kind ?? null, relabeled.body ?? null, relabeled.model, relabeled.prev_hash])) !== relabeled.hash, "changing which model wrote a post breaks its hash too");
ok(sha(tamperedInput) !== logEvents[1].hash, "an edited event no longer matches its hash");

// Public and private rooms.
// Public rooms show up in everyone's hallway, so live-site runs skip them: NO_PUBLIC=1.
if (!process.env.NO_PUBLIC) {
  const pubRoom = await j("/api/rooms", { method: "POST", body: JSON.stringify({ code: CODE, title: "Public e2e room", brief: "Find $y$.", name: "Pat", icon: "🦉", visibility: "public", topic: "science" }) });
  ok(pubRoom.status === 200 && pubRoom.data.visibility === "public" && !pubRoom.data.invite_code, "public room opens without an invite code");
  const listed = await j("/api/rooms?topic=science");
  ok(listed.data.rooms.some((x) => x.id === pubRoom.data.room_id && x.members[0].icon === "🦉"), "public room shows in the hallway with its people's icons");
  ok(!(await j("/api/rooms")).data.rooms.some((x) => x.id === room), "private rooms never show in the hallway");
  const pj = await j(`/api/r/${pubRoom.data.room_id}/join`, { method: "POST", body: JSON.stringify({ name: "Quinn", icon: "<b>x</b>" }) });
  ok(pj.status === 200 && pj.data.member_key?.length === 32, "anyone can take a seat in a public room");
  const quinn = await connect(`${BASE}/mcp/${pubRoom.data.room_id}/${pj.data.member_key}`);
  r = await call(quinn, "read_room", {});
  ok(!r.isError && r.data.you.name === "Quinn", "a self-serve seat works as a connector right away");
  ok((await j(`/api/r/${pubRoom.data.room_id}/state`)).data.members.find((m) => m.name === "Quinn").icon === null, "icons outside the fixed set are dropped");
  ok((await j("/api/rooms?topic=science")).data.rooms.find((x) => x.id === pubRoom.data.room_id).members.length === 2, "the hallway card updates when someone joins");
} else {
  ok(!(await j("/api/rooms")).data.rooms.some((x) => x.id === room), "private rooms never show in the hallway");
}
const privRoom = await j("/api/rooms", { method: "POST", body: JSON.stringify({ code: CODE, title: "Private e2e room", brief: "Find $z$.", name: "Pat", visibility: "private" }) });
ok(privRoom.data.invite_code?.length === 32, "private room comes with one invite link");
const noCode = await j(`/api/r/${privRoom.data.room_id}/join`, { method: "POST", body: JSON.stringify({ name: "Eve" }) });
ok(noCode.status === 403 && /private/.test(noCode.data.error), "private room refuses seats without the invite link");
const withCode = await j(`/api/r/${privRoom.data.room_id}/join`, { method: "POST", body: JSON.stringify({ name: "Ria", invite: privRoom.data.invite_code }) });
ok(withCode.status === 200, "the invite link gives anyone their own seat");
const notHostRotate = await j(`/api/r/${privRoom.data.room_id}/invite-link`, { method: "POST", headers: { "x-key": withCode.data.member_key }, body: "{}" });
ok(notHostRotate.status === 400, "only the host can change the invite link");
const rotated = await j(`/api/r/${privRoom.data.room_id}/invite-link`, { method: "POST", headers: { "x-key": privRoom.data.owner_key }, body: "{}" });
const oldCode = await j(`/api/r/${privRoom.data.room_id}/join`, { method: "POST", body: JSON.stringify({ name: "Bo", invite: privRoom.data.invite_code }) });
const newCode = await j(`/api/r/${privRoom.data.room_id}/join`, { method: "POST", body: JSON.stringify({ name: "Bo", invite: rotated.data.invite_code }) });
ok(oldCode.status === 403 && newCode.status === 200, "a new invite link turns the old one off");
ok((await fetch(`${BASE}/r/${privRoom.data.room_id}/invite`)).status === 200, "invite page loads");

// Presence: whose AI is working, waiting, away or not connected yet.
{
  const pr = await j("/api/rooms", { method: "POST", body: JSON.stringify({ code: CODE, title: "Presence", brief: "x", name: "Host" }) });
  const pm = await j(`/api/r/${pr.data.room_id}/invite`, { method: "POST", headers: { "x-key": pr.data.owner_key }, body: JSON.stringify({ name: "Late" }) });
  const presence = async (name) => (await j(`/api/r/${pr.data.room_id}/state`)).data.members.find((m) => m.name === name).presence;
  ok((await presence("Late")) === "new", "a member whose AI never connected shows as not connected");
  const late = await connect(`${BASE}/mcp/${pr.data.room_id}/${pm.data.member_key}`);
  await call(late, "read_room", {});
  ok((await presence("Late")) === "working", "right after its AI uses the room, it shows as working");
  await late.close();
}

// Start modes. "manual": nobody acts until the host starts the room.
const mkRoom = async (start_mode) => {
  const c = await j("/api/rooms", { method: "POST", body: JSON.stringify({ code: CODE, title: `Start mode ${start_mode}`, brief: "Find $x$.", name: "Host", start_mode }) });
  const m = await j(`/api/r/${c.data.room_id}/invite`, { method: "POST", headers: { "x-key": c.data.owner_key }, body: JSON.stringify({ name: "Friend" }) });
  return { id: c.data.room_id, owner: c.data.owner_key, member: m.data.member_key };
};
const man = await mkRoom("manual");
const manHost = await connect(`${BASE}/mcp/${man.id}/${man.owner}`);
const manFriend = await connect(`${BASE}/mcp/${man.id}/${man.member}`);
r = await call(manHost, "add_step", { title: "Plan" });
ok(r.isError && /hasn't started/.test(r.data), "manual: even the host's AI can't act before Start");
r = await call(manFriend, "read_room", {});
ok(!r.isError && r.data.status === "waiting to start" && /wait_for_activity/.test(r.data.next) && !/until they say/.test(r.data.next), "manual: read_room tells a waiting AI to keep waiting with wait_for_activity, not to stop");
const notHost = await j(`/api/r/${man.id}/start`, { method: "POST", headers: { "x-key": man.member }, body: "{}" });
ok(notHost.status === 400, "manual: only the host can start the room");
const go = await j(`/api/r/${man.id}/start`, { method: "POST", headers: { "x-key": man.owner }, body: "{}" });
ok(go.status === 200, "manual: host starts the room");
r = await call(manFriend, "add_step", { title: "Now it works" });
ok(!r.isError, "manual: after Start, AIs can work");
const manState = await j(`/api/r/${man.id}/state`);
ok(manState.data.started && manState.data.started_at > 0 && manState.data.events.some((e) => e.type === "started"), "manual: the start is on the record");

// The case from the first real test: the host's ChatGPT was told to start when
// another AI joined, ended its reply, and never came back when Claude arrived.
// Now the room keeps a waiting AI in its turn and wakes it when the room starts.
{
  const sc = await mkRoom("on_join");
  const gpt = await connect(`${BASE}/mcp/${sc.id}/${sc.owner}`);
  let rr = await call(gpt, "read_room", { model: "GPT-5" });
  ok(rr.data.status === "waiting to start" && /wait_for_activity/.test(rr.data.next), "scenario: the host's AI is told to keep waiting with wait_for_activity, not to stop");
  const t = Date.now();
  const gptWaiting = call(gpt, "wait_for_activity", { since_event: rr.data.last_event_id, seconds: 20 });
  await new Promise((res) => setTimeout(res, 800));
  const claude = await connect(`${BASE}/mcp/${sc.id}/${sc.member}`);
  await call(claude, "read_room", { model: "Claude Opus 5.5" });
  const woke = await gptWaiting;
  ok(!woke.isError && woke.data.status === "running" && woke.data.new_events >= 1 && Date.now() - t < 6000, "scenario: the waiting ChatGPT wakes up the moment Claude's first action starts the room");
  rr = await call(gpt, "read_room", { since_event: rr.data.last_event_id });
  ok(rr.data.status === "running" && !rr.data.next, "scenario: after waking, the host's AI sees a running room and can work");
  await gpt.close();
  await claude.close();
}

// "on_join": the host's AI may only plan until another member's AI shows up.
const oj = await mkRoom("on_join");
const ojHost = await connect(`${BASE}/mcp/${oj.id}/${oj.owner}`);
r = await call(ojHost, "add_step", { title: "Split the problem" });
ok(!r.isError, "on_join: host's AI can lay out steps while waiting");
r = await call(ojHost, "claim_step", { step_id: 1 });
ok(r.isError && /another person's AI/.test(r.data), "on_join: host's AI can't start solving alone");
ok((await j(`/api/r/${oj.id}/state`)).data.started === false, "on_join: connecting alone doesn't start the room");
const ojFriend = await connect(`${BASE}/mcp/${oj.id}/${oj.member}`);
ok((await j(`/api/r/${oj.id}/state`)).data.started === false, "on_join: a friend's app connecting isn't enough (it may just be fetching the tool list)");
r = await call(ojFriend, "read_room", {});
const ojState = await j(`/api/r/${oj.id}/state`);
ok(ojState.data.started && ojState.data.events.some((e) => e.type === "started" && e.body === "joined"), "on_join: the friend's AI's first action starts the room");
r = await call(ojHost, "claim_step", { step_id: 1 });
ok(!r.isError, "on_join: after the start, the host's AI can work");
ok((await j(`/api/r/${room}/state`)).data.start_mode === "open", "rooms opened without a mode keep v0's behaviour (open)");

for (const p of [`/r/${room}`, `/r/${room}/join`, `/r/${room}/admin`, "/", "/app.js", "/style.css"]) {
  const res = await fetch(BASE + p);
  ok(res.status === 200, `GET ${p.length > 30 ? p.slice(0, 30) + "…" : p}`);
}
const missing = await j(`/api/r/AAAAAAAAAAAAAAAA/state`);
ok(missing.status === 404, "unknown room is 404");

console.log(`\nroom for manual look: ${BASE}/r/${room}\nadmin: ${BASE}/r/${room}/admin#${ownerKey}`);
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
