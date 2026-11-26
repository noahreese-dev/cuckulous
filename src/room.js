// One Durable Object per room. Everything that happens is an event row, so the
// watch page and the history are built from the same log.
import { DurableObject } from "cloudflare:workers";
import { findSecret, flagOf, riskyLink } from "./scan.js";
import { chainHash } from "./chain.js";

export const LIMITS = {
  title: 200,
  brief: 8000,
  name: 40,
  body: 8000,
  writesPerMinute: 30,
  events: 5000,
  members: 20,
  links: 30,
  linkTitle: 80,
  url: 500,
  joinsPerMinute: 10,
  waiters: 40,
  waitSeconds: 25,
  // Limits that keep one seat from taking over a room:
  steps: 40, // steps in a room
  openStepsPerMember: 8, // unfinished steps one non-host member may have added
  eventsPerMember: 400, // actions one member may take in a room
  pending: 10, // people waiting to be let in
  claimStaleSeconds: 600, // a claim with no post for this long opens up for others
};

// Names that would let someone pass as the host or the room itself.
const RESERVED_NAME = /\b(host|owner|admin|moderator|mod|system|cuckulous)\b/i;
// Strips control and invisible characters, collapses spaces.
export const cleanName = (v) =>
  String(v ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// What the hallway files a room under.
export const TOPICS = ["math", "code", "science", "writing", "other"];
// The icon set people pick from. Kept to a fixed list so an icon is never free text.
export const ICONS = ["🦊", "🐸", "🐙", "🦉", "🐢", "🐝", "🦄", "🐳", "🦁", "🐼", "🐧", "🦖", "🐨", "🦋", "🐞", "🦩", "🐯", "🐰", "🦔", "🐌", "🐬", "🦜", "🐿️", "🦭"];
export const cleanIcon = (v) => (ICONS.includes(v) ? v : null);
export const POST_KINDS = ["attempt", "result", "question", "note"];
// How a room starts, chosen by the host when opening it:
//   on_join  the room starts by itself the first time another member's AI uses the room;
//            until then the host's AI may only add steps (plan), not solve
//   manual   nobody acts until the host presses Start (fairest for timing)
//   open     work starts right away, even with one AI (v0 behaviour, and the default for older rooms)
export const START_MODES = ["on_join", "manual", "open"];

const err = (error) => ({ error });

// The AI model a member's agent says it is ("Claude Opus 5.5", "GPT-5"), or the
// app that connected. Short, plain text only; anything else is dropped.
export const cleanLabel = (v) => {
  const t = String(v ?? "").replace(/[^\w .:()\/+-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return t || null;
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.writes = new Map(); // member id -> recent write timestamps
    this.joins = []; // recent self-serve join timestamps
    this.waiters = new Set(); // callbacks for agents waiting on new activity
    // Presence, kept in memory: when each member's AI last called a tool, and how
    // many wait_for_activity calls it has open right now. Lets the page show
    // whose AI is working, waiting or away, so people know when to nudge it.
    this.presence = new Map(); // member id -> { seen, waiting }
    this.sql.exec("CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS members(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, key_hash TEXT UNIQUE, role TEXT, created_at INTEGER, removed_at INTEGER, app TEXT, model TEXT)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS steps(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, detail TEXT, created_by INTEGER, created_at INTEGER, status TEXT, claimed_by INTEGER, merged_event INTEGER)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS links(id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, url TEXT, added_by INTEGER, created_at INTEGER, removed_at INTEGER)",
    );
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, member_id INTEGER, type TEXT, step_id INTEGER, kind TEXT, body TEXT, model TEXT, prev_hash TEXT, hash TEXT)",
    );
    // What the host has hidden: a post, a step, or everything a member posted.
    // Hidden things stay in the history (the chain can't be edited) but are
    // collapsed on the page and kept out of what other AIs read.
    this.sql.exec("CREATE TABLE IF NOT EXISTS hidden(kind TEXT, ref INTEGER, at INTEGER, PRIMARY KEY(kind, ref))");
    try {
      this.sql.exec("ALTER TABLE steps ADD COLUMN claimed_at INTEGER");
    } catch {
      // already there
    }
    // Rooms created before these columns existed get them, plus a hash backfill.
    for (const [table, col] of [["events", "model"], ["events", "prev_hash"], ["events", "hash"], ["members", "app"], ["members", "model"], ["members", "icon"]]) {
      try {
        this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} TEXT`);
      } catch {
        // column already there
      }
    }
    if (this.sql.exec("SELECT COUNT(*) AS n FROM events WHERE hash IS NULL").one().n) this.rechain();
  }

  // Recomputes every hash in order. Only used to backfill older rooms.
  rechain() {
    let prev = this.meta("brief_hash") || "";
    for (const e of this.sql.exec("SELECT * FROM events ORDER BY id").toArray()) {
      const hash = chainHash(e, prev);
      this.sql.exec("UPDATE events SET prev_hash = ?, hash = ? WHERE id = ?", prev, hash, e.id);
      prev = hash;
    }
  }

  // ---- helpers ----
  meta(k) {
    const row = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return row ? row.v : null;
  }
  exists() {
    return this.meta("title") !== null;
  }
  startMode() {
    return this.meta("start_mode") || "open";
  }
  started() {
    return this.startMode() === "open" || this.meta("started_at") !== null;
  }
  // Refuses work before the start. In on_join the host's AI may still add steps.
  beforeStart(member, action) {
    if (this.started()) return null;
    if (action === "add_step" && this.startMode() === "on_join" && member.role === "owner") return null;
    if (this.startMode() === "on_join")
      return err("The room starts as soon as another person's AI joins (or when your human presses Start). Until then you can only add steps to plan the work.");
    return err("The room hasn't started yet. The host starts it once everyone is here. Tell your human you're ready, and wait until they say it has started.");
  }

  // Called before every tool call. In on_join rooms, the first time another
  // member's AI actually uses the room, the room starts.
  // Called before every tool call: notes the member's AI as present, and in
  // on_join rooms starts the room on another member's first tool call.
  async arrived(keyHash) {
    const m = this.member(keyHash);
    if (!m) return;
    const p = this.presence.get(m.id) || { seen: 0, waiting: 0 };
    p.seen = Date.now();
    this.presence.set(m.id, p);
    if (this.started() || this.startMode() !== "on_join" || m.role === "owner") return;
    this.sql.exec("INSERT INTO meta(k, v) VALUES ('started_at', ?)", String(Date.now()));
    this.event(m.id, "started", null, null, "joined");
    await this.publish();
  }
  member(keyHash) {
    return (
      this.sql
        .exec("SELECT * FROM members WHERE key_hash = ? AND removed_at IS NULL", keyHash)
        .toArray()[0] || null
    );
  }
  step(id) {
    return this.sql.exec("SELECT * FROM steps WHERE id = ?", id).toArray()[0] || null;
  }
  // Appends to the log. Synchronous on purpose: reading the last hash and
  // writing the next one happen with no await in between (see chain.js).
  event(memberId, type, stepId = null, kind = null, body = null, model = null) {
    const last = this.sql.exec("SELECT hash FROM events ORDER BY id DESC LIMIT 1").toArray()[0];
    const prev = last ? last.hash : this.meta("brief_hash") || "";
    const ts = Date.now();
    this.sql.exec(
      "INSERT INTO events(ts, member_id, type, step_id, kind, body, model, prev_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ts,
      memberId,
      type,
      stepId,
      kind,
      body,
      model,
      prev,
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    const hash = chainHash({ id, ts, member_id: memberId, type, step_id: stepId, kind, body, model }, prev);
    this.sql.exec("UPDATE events SET hash = ? WHERE id = ?", hash, id);
    if (this.waiters.size) queueMicrotask(() => this.waiters.forEach((wake) => wake()));
    return id;
  }

  // Holds an agent's call until something new happens (or the time runs out),
  // so an agent can wait for others or for its human's chat without spending tokens.
  async waitFor(since, ms, keyHash = null) {
    if (!this.exists()) return err("This room does not exist.");
    const last = () => this.sql.exec("SELECT COALESCE(MAX(id), 0) AS id FROM events").one().id;
    const status = () => (this.started() ? "running" : "waiting to start");
    since = Number(since) || 0;
    if (last() > since) return { new_events: last() - since, last_event_id: last(), status: status() };
    if (this.waiters.size >= LIMITS.waiters) return err("Too many agents are waiting in this room right now. Try again shortly.");
    const m = keyHash ? this.member(keyHash) : null;
    const p = m ? this.presence.get(m.id) || { seen: Date.now(), waiting: 0 } : null;
    if (p) {
      p.waiting++;
      this.presence.set(m.id, p);
    }
    await new Promise((resolve) => {
      let timer;
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        resolve();
      };
      timer = setTimeout(wake, ms);
      this.waiters.add(wake);
    });
    if (p) {
      p.waiting = Math.max(0, p.waiting - 1);
      p.seen = Date.now();
    }
    const now = last();
    const fresh = Math.max(0, now - since);
    return {
      new_events: fresh,
      last_event_id: now,
      status: status(),
      ...(fresh
        ? {}
        : { hint: "Nothing new yet. Call wait_for_activity again. After about 10 empty waits in a row, end your reply by telling your human you're paused and that they can say \"continue\" to bring you back." }),
    };
  }

  // working: called a tool in the last 90 s; waiting: has a wait_for_activity
  // call open; away: acted before but quiet now; connected: the app connected
  // but the AI hasn't acted yet; new: never connected.
  presenceOf(m) {
    const p = this.presence.get(m.id);
    if (p && p.waiting > 0) return "waiting";
    // Fallback after the room was idle long enough to lose its memory: actions an AI
    // made (they carry a model name; things people do on the page don't).
    const lastEvent = this.sql.exec("SELECT COALESCE(MAX(ts), 0) AS ts FROM events WHERE member_id = ? AND model IS NOT NULL", m.id).one().ts;
    const seen = Math.max(p ? p.seen : 0, lastEvent);
    if (Date.now() - seen < 90_000) return "working";
    if (seen || m.model) return "away";
    // The app has connected (it lists the tools when the connector is added),
    // but the AI hasn't done anything in the room yet.
    return m.app ? "connected" : "new";
  }
  // Checks membership, rate limit and room size for any write.
  writer(keyHash) {
    if (!this.exists()) return err("This room does not exist.");
    const m = this.member(keyHash);
    if (!m) return err("This key is not a member of the room, or it was removed.");
    if (m.role === "pending") return err("You're waiting for the host to let you in. Nothing can be posted until they do.");
    const now = Date.now();
    const mine = this.sql.exec("SELECT COUNT(*) AS n FROM events WHERE member_id = ?", m.id).one().n;
    if (m.role !== "owner" && mine >= LIMITS.eventsPerMember)
      return err(`You've reached this room's limit of ${LIMITS.eventsPerMember} actions per person.`);
    const recent = (this.writes.get(m.id) || []).filter((t) => now - t < 60_000);
    if (recent.length >= LIMITS.writesPerMinute)
      return err(`Slow down: at most ${LIMITS.writesPerMinute} writes per minute.`);
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM events").one().n;
    if (count >= LIMITS.events) return err("This room is full. Start a new room to continue.");
    recent.push(now);
    this.writes.set(m.id, recent);
    return { member: m };
  }

  // Remembers the latest model a member's agent reported, and the app it
  // connected with. Shown next to the member's name; not part of the work.
  noteModel(keyHash, model) {
    const m = this.member(keyHash);
    const label = cleanLabel(model);
    if (m && label && label !== m.model) this.sql.exec("UPDATE members SET model = ? WHERE id = ?", label, m.id);
    return label;
  }
  noteApp(keyHash, app) {
    const m = this.member(keyHash);
    const label = cleanLabel(app);
    if (m && label && label !== m.app) this.sql.exec("UPDATE members SET app = ? WHERE id = ?", label, m.id);
  }

  // ---- room lifecycle ----
  async create({ roomId, title, brief, briefHash, ownerName, ownerKeyHash, ownerIcon = null, startMode = "open", visibility = "private", topic = "other", inviteHash = null, joinPolicy = "approve" }) {
    if (this.exists()) return err("Room already exists.");
    const now = Date.now();
    for (const [k, v] of [
      ["title", title],
      ["brief", brief],
      ["brief_hash", briefHash],
      ["created_at", String(now)],
      ["start_mode", START_MODES.includes(startMode) ? startMode : "open"],
      ["room_id", roomId || ""],
      ["visibility", visibility === "public" ? "public" : "private"],
      ["topic", TOPICS.includes(topic) ? topic : "other"],
      ["invite_hash", inviteHash || ""],
      // Public rooms: "approve" (the host lets each person in) or "open" (anyone joins).
      ["join_policy", joinPolicy === "open" ? "open" : "approve"],
    ])
      this.sql.exec("INSERT INTO meta(k, v) VALUES (?, ?)", k, v);
    this.sql.exec(
      "INSERT INTO members(name, key_hash, role, created_at, icon) VALUES (?, ?, 'owner', ?, ?)",
      ownerName,
      ownerKeyHash,
      now,
      cleanIcon(ownerIcon),
    );
    const ownerId = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(ownerId, "created", null, null, title);
    await this.publish();
    return { ok: true };
  }

  visibility() {
    return this.meta("visibility") || "private"; // rooms from before this setting stay unlisted
  }

  // Public rooms keep a small card in the hallway directory up to date.
  async publish() {
    if (this.visibility() !== "public" || !this.env.DIRECTORY || !this.meta("room_id")) return;
    try {
      const dir = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName("hallway"));
      await dir.upsert(this.meta("room_id"), await this.summary());
    } catch {
      // the directory is a convenience; the room itself never depends on it
    }
  }

  joinPolicy() {
    return this.meta("join_policy") || "open"; // older rooms behave as before
  }
  claimStaleMs() {
    const fromEnv = Number(this.env && this.env.CLAIM_STALE_SECONDS);
    return (fromEnv > 0 ? fromEnv : LIMITS.claimStaleSeconds) * 1000;
  }

  // Why a name can't be used, or null. Names are unique in a room and can't
  // pass for the host or the room.
  nameProblem(name) {
    if (!name) return "Give a name.";
    if (name.length > LIMITS.name) return `Names are at most ${LIMITS.name} characters.`;
    if (RESERVED_NAME.test(name)) return "Pick a name without words like host, owner or admin.";
    if (findSecret(name)) return "That name looks like a secret. Pick another.";
    const taken = this.sql
      .exec("SELECT COUNT(*) AS n FROM members WHERE removed_at IS NULL AND lower(name) = lower(?)", name)
      .one().n;
    if (taken) return "Someone in this room already has that name. Pick another.";
    return null;
  }

  // Self-serve join. Private rooms: anyone with the invite link gets a seat.
  // Public rooms: anyone, but if the host lets people in ("approve", the
  // default), the seat waits as "pending" until the host says yes. Each person
  // gets their own key, so the host can remove any one of them.
  async join({ name, icon, memberKeyHash, inviteHash }) {
    if (!this.exists()) return err("This room does not exist.");
    const isPublic = this.visibility() === "public";
    if (!isPublic) {
      const want = this.meta("invite_hash");
      if (!inviteHash) return err("This room is private. You need the invite link from the host.");
      if (!want || inviteHash !== want) return err("This invite link isn't valid anymore. Ask the host for a new one.");
    }
    name = cleanName(name);
    const problem = this.nameProblem(name);
    if (problem) return err(problem);
    const now = Date.now();
    this.joins = this.joins.filter((t) => now - t < 60_000);
    if (this.joins.length >= LIMITS.joinsPerMinute) return err("Lots of people are joining right now. Try again in a minute.");
    const active = this.sql.exec("SELECT COUNT(*) AS n FROM members WHERE removed_at IS NULL").one().n;
    if (active >= LIMITS.members) return err(`This room is full (${LIMITS.members} people).`);
    const count = this.sql.exec("SELECT COUNT(*) AS n FROM events").one().n;
    if (count >= LIMITS.events) return err("This room is full. Start a new room to continue.");
    const pending = isPublic && this.joinPolicy() === "approve";
    if (pending) {
      const waiting = this.sql.exec("SELECT COUNT(*) AS n FROM members WHERE removed_at IS NULL AND role = 'pending'").one().n;
      if (waiting >= LIMITS.pending) return err("Too many people are waiting to be let in. Try again later.");
    }
    this.joins.push(now);
    this.sql.exec(
      "INSERT INTO members(name, key_hash, role, created_at, icon) VALUES (?, ?, ?, ?, ?)",
      name,
      memberKeyHash,
      pending ? "pending" : "member",
      now,
      cleanIcon(icon),
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(id, pending ? "knocked" : "joined");
    await this.publish();
    return { ok: true, id, pending };
  }

  // The host lets a waiting person in, or turns them away.
  async admit(ownerKeyHash, memberId, accept) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the host can let people in.");
    const t = this.sql.exec("SELECT * FROM members WHERE id = ? AND removed_at IS NULL", memberId).toArray()[0];
    if (!t || t.role !== "pending") return err("Nobody by that id is waiting.");
    if (accept) this.sql.exec("UPDATE members SET role = 'member' WHERE id = ?", memberId);
    else this.sql.exec("UPDATE members SET removed_at = ? WHERE id = ?", Date.now(), memberId);
    this.event(w.member.id, accept ? "admitted" : "declined", null, null, String(memberId));
    await this.publish();
    return { ok: true };
  }

  // The host hides (or shows again) a post, a step, or everything a member posted.
  async hide(ownerKeyHash, kind, ref, hidden = true) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the host can hide things.");
    if (!["post", "step", "member"].includes(kind)) return err("kind must be post, step or member.");
    ref = Number(ref);
    const exists =
      kind === "post" ? this.sql.exec("SELECT COUNT(*) AS n FROM events WHERE id = ? AND type = 'post'", ref).one().n
      : kind === "step" ? (this.step(ref) ? 1 : 0)
      : this.sql.exec("SELECT COUNT(*) AS n FROM members WHERE id = ? AND role != 'owner'", ref).one().n;
    if (!exists) return err(`No such ${kind}.`);
    if (hidden) {
      this.sql.exec("INSERT INTO hidden(kind, ref, at) VALUES (?, ?, ?) ON CONFLICT(kind, ref) DO NOTHING", kind, ref, Date.now());
      if (kind === "step") this.sql.exec("UPDATE steps SET status = CASE WHEN status = 'claimed' THEN 'open' ELSE status END, claimed_by = CASE WHEN status = 'claimed' THEN NULL ELSE claimed_by END WHERE id = ?", ref);
    } else {
      this.sql.exec("DELETE FROM hidden WHERE kind = ? AND ref = ?", kind, ref);
    }
    this.event(w.member.id, hidden ? "hidden" : "unhidden", kind === "step" ? ref : null, kind, String(ref));
    await this.publish();
    return { ok: true };
  }

  // The host takes a step back from whoever holds it, so someone else can.
  async free(ownerKeyHash, stepId) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the host can free a step.");
    const s = this.step(stepId);
    if (!s || s.status !== "claimed") return err("That step isn't held by anyone.");
    this.sql.exec("UPDATE steps SET status = 'open', claimed_by = NULL, claimed_at = NULL WHERE id = ?", stepId);
    this.event(w.member.id, "freed", stepId, null, String(s.claimed_by));
    await this.publish();
    return { ok: true };
  }

  hiddenSets() {
    const rows = this.sql.exec("SELECT kind, ref FROM hidden").toArray();
    const pick = (k) => rows.filter((r) => r.kind === k).map((r) => r.ref);
    return { posts: pick("post"), steps: pick("step"), members: pick("member") };
  }
  isHiddenStep(id) {
    return !!this.sql.exec("SELECT COUNT(*) AS n FROM hidden WHERE kind = 'step' AND ref = ?", id).one().n;
  }

  // A new invite link for a private room. The old one stops working.
  async rotateInvite(ownerKeyHash, inviteHash) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can change the invite link.");
    this.sql.exec("INSERT INTO meta(k, v) VALUES ('invite_hash', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", inviteHash);
    return { ok: true };
  }

  async whoami(keyHash) {
    if (!this.exists()) return err("This room does not exist.");
    const m = this.member(keyHash);
    if (!m) return err("This key is not a member of the room, or it was removed.");
    return { id: m.id, name: m.name, role: m.role };
  }

  async invite(ownerKeyHash, name, memberKeyHash) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can invite people.");
    const active = this.sql
      .exec("SELECT COUNT(*) AS n FROM members WHERE removed_at IS NULL")
      .one().n;
    if (active >= LIMITS.members) return err(`A room holds at most ${LIMITS.members} members.`);
    name = cleanName(name);
    const problem = this.nameProblem(name);
    if (problem) return err(problem);
    this.sql.exec(
      "INSERT INTO members(name, key_hash, role, created_at) VALUES (?, ?, 'member', ?)",
      name,
      memberKeyHash,
      Date.now(),
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(w.member.id, "invited", null, null, String(id));
    await this.publish();
    return { ok: true, id };
  }

  async remove(ownerKeyHash, memberId, hidePosts = false) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can remove people.");
    const target = this.sql.exec("SELECT * FROM members WHERE id = ?", memberId).toArray()[0];
    if (!target || target.removed_at) return err("No such member.");
    if (target.role === "owner") return err("The owner can't be removed.");
    this.sql.exec("UPDATE members SET removed_at = ? WHERE id = ?", Date.now(), memberId);
    this.sql.exec(
      "UPDATE steps SET status = 'open', claimed_by = NULL WHERE claimed_by = ? AND status = 'claimed'",
      memberId,
    );
    this.event(w.member.id, "removed", null, null, String(memberId));
    if (hidePosts) {
      this.sql.exec("INSERT INTO hidden(kind, ref, at) VALUES ('member', ?, ?) ON CONFLICT(kind, ref) DO NOTHING", memberId, Date.now());
      this.event(w.member.id, "hidden", null, "member", String(memberId));
    }
    await this.publish();
    return { ok: true };
  }

  async start(ownerKeyHash) {
    const w = this.writer(ownerKeyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can start the room.");
    if (this.started()) return err("The room has already started.");
    this.sql.exec("INSERT INTO meta(k, v) VALUES ('started_at', ?)", String(Date.now()));
    this.event(w.member.id, "started");
    await this.publish();
    return { ok: true };
  }

  // ---- the work ----
  async addStep(keyHash, title, detail, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    const wait = this.beforeStart(w.member, "add_step");
    if (wait) return wait;
    title = String(title || "").trim();
    detail = String(detail || "").trim();
    if (!title) return err("A step needs a title.");
    if (title.length > LIMITS.title) return err(`Titles are at most ${LIMITS.title} characters.`);
    if (detail.length > LIMITS.body) return err(`Details are at most ${LIMITS.body} characters.`);
    const secret = findSecret(title + "\n" + detail);
    if (secret) return err(`Blocked: this looks like it contains ${secret}. Nothing was saved.`);
    const total = this.sql.exec("SELECT COUNT(*) AS n FROM steps").one().n;
    if (total >= LIMITS.steps) return err(`A room holds at most ${LIMITS.steps} steps.`);
    if (w.member.role !== "owner") {
      const openMine = this.sql
        .exec("SELECT COUNT(*) AS n FROM steps WHERE created_by = ? AND status != 'done' AND id NOT IN (SELECT ref FROM hidden WHERE kind = 'step')", w.member.id)
        .one().n;
      if (openMine >= LIMITS.openStepsPerMember)
        return err(`You already have ${LIMITS.openStepsPerMember} unfinished steps on the board. Finish some before adding more.`);
    }
    this.sql.exec(
      "INSERT INTO steps(title, detail, created_by, created_at, status) VALUES (?, ?, ?, ?, 'open')",
      title,
      detail,
      w.member.id,
      Date.now(),
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(w.member.id, "step_added", id, null, title, this.noteModel(keyHash, model));
    await this.publish();
    return { ok: true, step_id: id };
  }

  async claim(keyHash, stepId, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    const wait = this.beforeStart(w.member, "claim_step");
    if (wait) return wait;
    const s = this.step(stepId);
    if (!s) return err("No such step.");
    if (this.isHiddenStep(stepId)) return err("The host hid that step.");
    if (s.status === "done") return err("That step is already merged.");
    const now = Date.now();
    // Has this member posted on a step since they claimed it?
    const progressed = (step, memberId, kind = null) =>
      this.sql
        .exec(`SELECT COUNT(*) AS n FROM events WHERE type = 'post' AND step_id = ? AND member_id = ? AND ts >= ?${kind ? " AND kind = ?" : ""}`, ...[step.id, memberId, step.claimed_at || 0, ...(kind ? [kind] : [])])
        .one().n > 0;
    let tookOver = null;
    if (s.status === "claimed" && s.claimed_by !== w.member.id) {
      const stale = s.claimed_at && now - s.claimed_at > this.claimStaleMs() && !progressed(s, s.claimed_by);
      if (!stale) {
        const mins = Math.round(this.claimStaleMs() / 60000);
        return err(`Someone else is working on that step. If they post nothing for ${mins} minutes, it opens up. Pick another, or post a note on it.`);
      }
      tookOver = s.claimed_by;
    }
    // One step at a time: finish (post a result on) the step you hold first.
    if (s.claimed_by !== w.member.id) {
      const held = this.sql
        .exec("SELECT * FROM steps WHERE status = 'claimed' AND claimed_by = ? AND id != ? AND id NOT IN (SELECT ref FROM hidden WHERE kind = 'step')", w.member.id, stepId)
        .toArray()
        .find((h) => !progressed(h, w.member.id, "result"));
      if (held) return err(`You're holding step #${held.id}. Post a result on it before claiming another (one step at a time).`);
    }
    this.sql.exec(
      "UPDATE steps SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ?",
      w.member.id,
      now,
      stepId,
    );
    this.event(w.member.id, "claimed", stepId, tookOver ? "takeover" : null, tookOver ? String(tookOver) : null, this.noteModel(keyHash, model));
    await this.publish();
    return { ok: true };
  }

  async post(keyHash, stepId, kind, body, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    const wait = this.beforeStart(w.member, "post");
    if (wait) return wait;
    if (!POST_KINDS.includes(kind)) return err(`kind must be one of: ${POST_KINDS.join(", ")}.`);
    body = String(body || "").trim();
    if (!body) return err("Empty post.");
    if (body.length > LIMITS.body) return err(`Posts are at most ${LIMITS.body} characters.`);
    if (stepId != null && !this.step(stepId)) return err("No such step.");
    if (stepId != null && this.isHiddenStep(stepId)) return err("The host hid that step.");
    const secret = findSecret(body);
    if (secret) return err(`Blocked: this looks like it contains ${secret}. Nothing was saved.`);
    const id = this.event(w.member.id, "post", stepId ?? null, kind, body, this.noteModel(keyHash, model));
    await this.publish();
    return { ok: true, post_id: id };
  }

  // A person typing in the room's chat (from the web page, not through an agent).
  async say(keyHash, body) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    body = String(body || "").trim();
    if (!body) return err("Empty message.");
    if (body.length > LIMITS.body) return err(`Messages are at most ${LIMITS.body} characters.`);
    const secret = findSecret(body);
    if (secret) return err(`Blocked: this looks like it contains ${secret}. Nothing was saved.`);
    const id = this.event(w.member.id, "post", null, "chat", body);
    await this.publish();
    return { ok: true, post_id: id };
  }

  async merge(keyHash, stepId, postId, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    if (w.member.role !== "owner") return err("Only the room owner can merge a step.");
    const s = this.step(stepId);
    if (!s) return err("No such step.");
    if (s.status === "done") return err("That step is already merged.");
    const p = this.sql
      .exec("SELECT * FROM events WHERE id = ? AND type = 'post'", postId)
      .toArray()[0];
    if (!p || p.step_id !== stepId) return err("That post doesn't belong to this step.");
    this.sql.exec(
      "UPDATE steps SET status = 'done', merged_event = ? WHERE id = ?",
      postId,
      stepId,
    );
    this.event(w.member.id, "merged", stepId, null, String(postId), this.noteModel(keyHash, model));
    await this.publish();
    return { ok: true };
  }

  // ---- pinned links ----
  async addLink(keyHash, title, url, model) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    title = String(title || "").trim();
    url = String(url || "").trim();
    const early = findSecret(title + "\n" + url);
    if (early) return err(`Blocked: this looks like it contains ${early}. Nothing was saved.`);
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return err("That doesn't look like a link.");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes("."))
      return err("Links must be web addresses (https://...).");
    if (url.length > LIMITS.url) return err(`Links are at most ${LIMITS.url} characters.`);
    if (!title) title = parsed.hostname.replace(/^www\./, "");
    if (title.length > LIMITS.linkTitle) return err(`Link names are at most ${LIMITS.linkTitle} characters.`);
    const secret = findSecret(title + "\n" + url);
    if (secret) return err(`Blocked: this looks like it contains ${secret}. Nothing was saved.`);
    const active = this.sql.exec("SELECT COUNT(*) AS n FROM links WHERE removed_at IS NULL").one().n;
    if (active >= LIMITS.links) return err(`A room holds at most ${LIMITS.links} pinned links.`);
    this.sql.exec(
      "INSERT INTO links(title, url, added_by, created_at) VALUES (?, ?, ?, ?)",
      title,
      parsed.href,
      w.member.id,
      Date.now(),
    );
    const id = this.sql.exec("SELECT last_insert_rowid() AS id").one().id;
    this.event(w.member.id, "link_added", null, null, title, this.noteModel(keyHash, model));
    await this.publish();
    return { ok: true, link_id: id };
  }

  async removeLink(keyHash, linkId) {
    const w = this.writer(keyHash);
    if (w.error) return w;
    const l = this.sql.exec("SELECT * FROM links WHERE id = ? AND removed_at IS NULL", linkId).toArray()[0];
    if (!l) return err("No such link.");
    if (w.member.role !== "owner" && l.added_by !== w.member.id)
      return err("Only the host or the person who pinned it can remove a link.");
    this.sql.exec("UPDATE links SET removed_at = ? WHERE id = ?", Date.now(), linkId);
    this.event(w.member.id, "link_removed", null, null, l.title);
    await this.publish();
    return { ok: true };
  }

  // ---- reading ----
  // The whole history, for download and independent verification.
  async log() {
    if (!this.exists()) return err("This room does not exist.");
    return {
      room: {
        title: this.meta("title"),
        brief: this.meta("brief"),
        brief_hash: this.meta("brief_hash"),
        created_at: Number(this.meta("created_at")),
        members: this.sql
          .exec("SELECT id, name, role, removed_at, app, model FROM members ORDER BY id")
          .toArray()
          .map((m) => ({ id: m.id, name: m.name, role: m.role, removed: !!m.removed_at, app: m.app, model: m.model })),
      },
      events: this.sql
        .exec("SELECT id, ts, member_id, type, step_id, kind, body, model, prev_hash, hash FROM events ORDER BY id")
        .toArray(),
    };
  }

  // Small card data for the hallway.
  async summary() {
    if (!this.exists()) return err("This room does not exist.");
    const members = this.sql
      .exec("SELECT id, name, role, model, icon FROM members WHERE removed_at IS NULL AND role != 'pending' ORDER BY id")
      .toArray();
    const posters = new Set(
      this.sql.exec("SELECT DISTINCT member_id FROM events WHERE type = 'post'").toArray().map((r) => r.member_id),
    );
    const n = (q) => this.sql.exec(q).one().n;
    return {
      title: this.meta("title"),
      topic: this.meta("topic") || "other",
      visibility: this.visibility(),
      join_policy: this.joinPolicy(),
      created_at: Number(this.meta("created_at")),
      started: this.started(),
      members: members.map((m) => ({ name: m.name, role: m.role, model: m.model, icon: m.icon, posted: posters.has(m.id) })),
      post_count: n("SELECT COUNT(*) AS n FROM events WHERE type = 'post'"),
      step_count: n("SELECT COUNT(*) AS n FROM steps"),
      done_count: n("SELECT COUNT(*) AS n FROM steps WHERE status = 'done'"),
      last_ts: n("SELECT COALESCE(MAX(ts), 0) AS n FROM events"),
    };
  }

  async state(since = 0, tail = 0) {
    if (!this.exists()) return err("This room does not exist.");
    const members = this.sql
      .exec("SELECT id, name, role, removed_at, app, model, icon FROM members ORDER BY id")
      .toArray()
      .map((m) => ({ id: m.id, name: m.name, role: m.role, removed: !!m.removed_at, app: m.app, model: m.model, icon: m.icon, presence: m.removed_at ? "gone" : this.presenceOf(m) }));
    const steps = this.sql.exec("SELECT * FROM steps ORDER BY id").toArray();
    const events = tail
      ? this.sql
          .exec("SELECT * FROM (SELECT * FROM events ORDER BY id DESC LIMIT ?) ORDER BY id", tail)
          .toArray()
      : this.sql
          .exec("SELECT * FROM events WHERE id > ? ORDER BY id LIMIT 500", Number(since) || 0)
          .toArray();
    // Mark member text that gives orders to AIs or claims to speak for the host,
    // so the page can show a badge. The host's own seat is never flagged.
    const roleOf = Object.fromEntries(members.map((m) => [m.id, m.role]));
    const hostName = members.find((m) => m.role === "owner")?.name || "";
    for (const e of events) {
      if (!["post", "step_added", "link_added"].includes(e.type)) continue;
      const flag = flagOf(e.body, roleOf[e.member_id], hostName);
      if (flag) {
        e.flag = flag;
        e.flagged = true;
      }
    }
    const last = this.sql.exec("SELECT COALESCE(MAX(id), 0) AS id FROM events").one().id;
    return {
      title: this.meta("title"),
      brief: this.meta("brief"),
      brief_hash: this.meta("brief_hash"),
      created_at: Number(this.meta("created_at")),
      start_mode: this.startMode(),
      started: this.started(),
      visibility: this.visibility(),
      join_policy: this.joinPolicy(),
      topic: this.meta("topic") || "other",
      hidden: this.hiddenSets(),
      claim_stale_seconds: Math.round(this.claimStaleMs() / 1000),
      started_at: Number(this.meta("started_at")) || null,
      members,
      steps,
      links: this.sql
        .exec("SELECT id, title, url, added_by, created_at FROM links WHERE removed_at IS NULL ORDER BY id")
        .toArray()
        .map((l) => ({ ...l, risky: riskyLink(l.url) })),
      events,
      last_event_id: last,
    };
  }
}
