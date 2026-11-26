#!/usr/bin/env node
// Turns a room's history into a normal git repo: one commit per merged step.
//
//   node tools/room-to-git.mjs <watch link or room id> [--base https://...] [--out dir]
//
// Only reads public data (the watch link's /log and /state), so anyone can run it.
// It checks the hash chain first and refuses a history that doesn't verify.
// Run it again on the same --out folder and it adds only the steps merged since.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : dflt;
};
let base = flag("--base", null);
let out = flag("--out", null);
const target = args[0];
if (!target) {
  console.error("usage: room-to-git.mjs <watch link or room id> [--base URL] [--out dir]");
  process.exit(2);
}
let roomId = target;
const m = target.match(/^(https?:\/\/[^/]+)\/r\/([A-Za-z0-9_-]{16})/);
if (m) {
  base ||= m[1];
  roomId = m[2];
}
if (!/^[A-Za-z0-9_-]{16}$/.test(roomId)) throw new Error(`Not a room id: ${roomId}`);
base ||= "https://cuckulous.cuckulous.workers.dev";
out ||= `room-${roomId}`;

const sha = (s) => createHash("sha256").update(s).digest("hex");
const get = async (path) => {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r;
};

// ---- read and verify ----
const lines = (await (await get(`/api/r/${roomId}/log`)).text()).trim().split("\n").map((l) => JSON.parse(l));
const room = lines[0].room;
const events = lines.slice(1);
if (sha(room.brief) !== room.brief_hash) throw new Error("The brief doesn't match its hash. Refusing to export.");
let prev = room.brief_hash;
for (const e of events) {
  const input = JSON.stringify([e.id, e.ts, e.member_id, e.type, e.step_id ?? null, e.kind ?? null, e.body ?? null, e.model ?? null, prev]);
  if (e.prev_hash !== prev || sha(input) !== e.hash) throw new Error(`History breaks at event ${e.id}. Refusing to export.`);
  prev = e.hash;
}
const state = await (await get(`/api/r/${roomId}/state`)).json();
const members = Object.fromEntries((room.members || state.members).map((x) => [x.id, x]));
const steps = Object.fromEntries(state.steps.map((s) => [s.id, s]));
const byId = Object.fromEntries(events.map((e) => [e.id, e]));
const nameOf = (id) => members[id]?.name || `member ${id}`;
// .invalid is reserved (RFC 2606), so these addresses can never reach anyone.
const emailOf = (id) => `member-${id}@${roomId.toLowerCase()}.cuckulous.invalid`;

// ---- git helpers ----
const git = (argv, env = {}) =>
  execFileSync("git", ["-C", out, ...argv], { encoding: "utf8", env: { ...process.env, ...env } });
// git commit -F - reads the message from stdin
const commitMsg = (message, who, ts) => {
  const date = `${Math.floor(ts / 1000)} +0000`;
  git(["add", "-A"]);
  execFileSync("git", ["-C", out, "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-F", "-"], {
    input: message,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: nameOf(who),
      GIT_AUTHOR_EMAIL: emailOf(who),
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_NAME: nameOf(who),
      GIT_COMMITTER_EMAIL: emailOf(who),
      GIT_COMMITTER_DATE: date,
    },
  });
};

// ---- set up or resume the repo ----
let done = new Set();
if (existsSync(join(out, ".git"))) {
  const firstRoom = git(["log", "--format=%(trailers:key=Room,valueonly)"]).trim().split("\n").filter(Boolean).pop();
  if (firstRoom && firstRoom !== roomId) throw new Error(`${out} holds room ${firstRoom}, not ${roomId}.`);
  done = new Set(git(["log", "--format=%(trailers:key=Room-Event,valueonly)"]).split("\n").map((s) => s.trim()).filter(Boolean).map(Number));
} else {
  if (existsSync(out) && readdirSync(out).length) throw new Error(`${out} exists and isn't empty.`);
  mkdirSync(out, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", out]);
}

const created = events.find((e) => e.type === "created");
if (!done.has(created.id)) {
  writeFileSync(
    join(out, "README.md"),
    `# ${room.title}\n\n## Brief\n\n${room.brief}\n\nBrief hash: \`${room.brief_hash}\`\n\nWatch: ${base}/r/${roomId}\n\nEach later commit is one step the host merged in the room. Author = the person whose AI wrote the merged post; dates are the room's own timestamps. \`history.jsonl\` is the room's hash-chained log; check it with \`node tools/room-to-git.mjs\` or the room's Verify history button.\n`,
  );
  commitMsg(`Open room: ${room.title}\n\nRoom: ${roomId}\nRoom-Event: ${created.id}\nRoom-Hash: ${created.hash}\n`, created.member_id, created.ts);
}

const slug = (s) => s.toLowerCase().replace(/\$[^$]*\$/g, "math").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "step";
let added = 0;
mkdirSync(join(out, "steps"), { recursive: true });
for (const e of events.filter((x) => x.type === "merged")) {
  if (done.has(e.id)) continue;
  const st = steps[e.step_id] || { title: `Step ${e.step_id}`, detail: "" };
  const post = byId[Number(e.body)];
  if (!post) throw new Error(`Merge event ${e.id} points at missing post ${e.body}.`);
  const file = join("steps", `${String(e.step_id).padStart(3, "0")}-${slug(st.title)}.md`);
  writeFileSync(
    join(out, file),
    [
      `# Step #${e.step_id}: ${st.title}`,
      "",
      st.detail ? `${st.detail}\n` : null,
      `## Merged ${post.kind} by ${nameOf(post.member_id)}${post.model ? ` (${post.model})` : ""}`,
      "",
      post.body,
      "",
      `Post ${post.id}, merged by ${nameOf(e.member_id)} at ${new Date(e.ts).toISOString()}.`,
      "",
    ].filter((x) => x !== null).join("\n"),
  );
  writeFileSync(join(out, "history.jsonl"), lines.slice(0, 1 + events.indexOf(e) + 1).map((l) => JSON.stringify(l)).join("\n") + "\n");
  commitMsg(
    `Step #${e.step_id}: ${st.title}\n\nSolved by ${nameOf(post.member_id)}${post.model ? ` (${post.model})` : ""}, merged by ${nameOf(e.member_id)}.\n\nRoom: ${roomId}\nRoom-Event: ${e.id}\nRoom-Post: ${post.id}\nRoom-Hash: ${e.hash}\n`,
    post.member_id,
    e.ts,
  );
  added++;
}
console.log(`${out}: ${added} new step commit${added === 1 ? "" : "s"}, history verified through event ${events.at(-1)?.id ?? 0}.`);
