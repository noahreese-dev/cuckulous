# SPEC: room v0

## Problem

Two to five people want their own AI (ChatGPT, Claude, or a harness such as Claude Code) to work on one problem together, and anyone with a private link should be able to watch the progress live.

## Decisions (from Noah, 2026-11-25)

- Accounts connect as a connector: the room is a remote MCP server, and each member pastes their own room URL into ChatGPT, Claude or a harness.
- Agents act only while their human is chatting. No always-on agents in v0.
- Anyone with the private watch link can watch. Only invited members can post.
- First problems: math, plus other kinds.
- Build now; the Buzz test is skipped.
- Look (2026-11-25): early Clubhouse style. Cream hallway of room cards, a green "+ Start a room" pill, rooms as a white sheet with a stage of rounded-square avatars (green ring = posted in the last 90 seconds), "Leave quietly" bottom bar. Our own name and icons, no Clubhouse logo.
- Top-right switcher (2026-11-25), modeled on Pi Desktop's: one pill shows the current section; click and Links, Progress, To-do and History spread out to the left; pick one and its panel drops down. Links holds the room's own links plus pinned links (anyone in the room, or an agent via `pin_link`). Progress builds itself from the event log. To-do lists open and claimed steps and lets people add one. History is the full log. The bottom bar's history and share buttons and the hallway's decorative search, calendar and bell icons were removed.
- Room chat (2026-11-25): people type in a chat sheet. Your own agent gets your messages flagged `from_your_human`; every other agent gets them as untrusted text.
- No sign-up: this device remembers your name and rooms. Opening a room still takes the host code.

## Stories

1. As a room owner, I enter a creator code, a title, a brief and my name, and get a watch link, my own connector URL and an admin page.
2. As an owner, I type a friend's name and get a join link to send them.
3. As a member, the join link shows me the brief and the safety checklist before it shows my connector URL.
4. As a member's agent, I can read the room, add a step, claim a step, and post an attempt, result, question or note.
5. As an owner, I merge a step by picking the post that solves it, from the admin page or through my agent.
6. As a watcher, I open the watch link and see the brief, the board and the full timeline, with math rendered, updating every few seconds.
7. As an owner, I remove a member and their URL stops working at once.

## Scope

- One Cloudflare Worker plus one Durable Object (SQLite) per room.
- MCP over Streamable HTTP, stateless JSON responses, hand-written (no SDK).
- Tools: `read_room`, `add_step`, `claim_step`, `post`, `pin_link`, `merge_step` (owner only).
- `wait_for_activity` (2026-11-26): holds the call up to 25 s and returns as soon as any new event lands, so a harness agent (Claude Code in a build room) can wait for chat or merges without sleep loops. At most 40 waiting calls per room. Read-only.
- Timing for chat AIs (2026-11-26): presence per member (`working`, `waiting`, `away`, `new`), kept in memory with a fallback to the member's last action that carries a model name. `wait_for_activity` also returns `status`, and when nothing happened, a hint to keep waiting and then ask the human for "continue". In a waiting room, read_room's `next` hint says to keep calling `wait_for_activity` instead of ending the reply; `idle_hint` appears when nothing is open for the agent. The room page shows presence on stage and a "your AI" card with the next thing to do.
- `npm run export -- <watch link>` (2026-11-26): room to git, one commit per merged step; refuses a history that doesn't verify.
- Page actions for key holders: pin/unpin a link, add a to-do, type in chat.
- Pages: hallway (your rooms + start a room), watch, join, admin. `GET /api/r/<id>/summary` feeds the hallway cards.
- Safety rules from SECURITY.md that v0 enforces:
  - The brief is fixed at creation and shown with its hash; changing it means making a new room.
  - Delegation is pull-only: agents claim steps; no tool sends instructions to another agent.
  - Other people's text is returned inside an `untrusted` field with author and time.
  - Posts are scanned for secret patterns and blocked on a match.
  - Limits: 8,000 characters per post, 30 writes per minute per member, 5,000 events per room.
  - Keys: 24 random bytes per member; only SHA-256 hashes are stored. Keys in browser pages live after `#` so they never reach server logs.
  - Room creation requires a creator code (Worker secret).

## Acceptance

- A real MCP client (the official TypeScript SDK) can initialize, list the tools and call each one against the deployed URL.
- A post containing `sk-ant-...` or `ghp_...` is rejected and nothing is stored.
- A non-owner calling `merge_step` gets an error.
- A removed member's URL returns an error on the next call.
- The watch page shows a post with `$x^2$` rendered by KaTeX.
- `/.well-known/oauth-protected-resource` returns 404, so ChatGPT and Claude treat the server as no-auth.

## Added after v0 (first attempt, Husein)

- **Hash-chained history.** Each event stores `prev_hash` and `hash` (SHA-256 over the event's fields and the previous hash). The first event points at the brief's hash. Older rooms are backfilled the first time they load. `GET /api/r/<room>/log` returns the whole history as JSON lines (a room line, then one line per event). The room page has **Verify history** (re-checks every link with WebCrypto) and **Download**. The hash is computed synchronously in the Durable Object (`src/chain.js`), so reading the last hash and writing the next one can't be interleaved.
- **Join page in five steps:** the brief, what the room tells your AI (a plain summary, the exact server instructions and the actions, served by `GET /api/instructions`, which is the same text the MCP server sends), staying safe, connecting with one app at a time (Claude, ChatGPT, Claude Code, other), then the sentence to say to your AI.
- **Who did what** on every room page, built from events: steps added and claimed, attempts, results, notes, merged posts and last activity per member, plus a "work by model" table.
- **Which model did the work.** All tools take an optional `model` (the AI's own name for itself, e.g. "Claude Opus 5.5"), stored on each event and on the member. It's cleaned to plain text up to 60 characters and covered by the event hash. The MCP `initialize` call's `clientInfo.name` is stored as the member's app (claude.ai, ChatGPT, Claude Code...). Both are self-reported, and the page says so.
- **Teamwork guidance** in the server instructions: split work into parallel steps (about two open steps per member), claim one step at a time and post a result before the next, don't start a step someone else claimed, and read with `since_event`.
- **Start modes**, chosen when opening a room (`start_mode`): `on_join` (default in the UI: the host's AI may only `add_step` until another member's AI makes its first tool call, then the room starts by itself), `open` (v0 behaviour, and the API default), `manual` (nobody acts until the host calls `POST /api/r/<id>/start`). Before the start, the server refuses the blocked actions with a plain explanation, and `read_room` returns `status` plus a `next` hint. The start is a `started` event in the history.
- **How they're working together** section on the room page: a timeline lane per person and AI, a relay per step, and headline numbers (time since the start, share of time with 2+ AIs working at once, handoffs, weigh-ins, merged steps, models), plus a "who did what, in numbers" sheet.
- **Hallway, public and private rooms.** Rooms get `visibility` (`private` by default, `public`) and a `topic` at creation. Public rooms keep a card in a `Directory` Durable Object (one instance, `GET /api/rooms?topic=`), updated after every write; private rooms are never listed. `POST /api/r/<id>/join {name, icon, invite}` gives anyone a seat in a public room, or anyone with the invite code in a private one (`/r/<id>/invite#<code>`); each seat is its own member key. `POST /api/r/<id>/invite-link` (owner) replaces the invite code. Self-serve joins are limited to 10 a minute per room and 20 members. People pick an icon from a fixed set of 24 (anything else is dropped), and avatars show a badge for their AI's model.
- **Benchmark** in `bench/`: compares one model alone with rooms of one or more agents that join over MCP. It's a research tool you run with your own keys, not a feature of the room.

Acceptance (also in `test/e2e.mjs`): the downloaded chain verifies from the brief's hash to the last event, an edited event (or a changed model label) no longer matches its hash, `/api/instructions` returns exactly the instructions and tools the MCP server sends, and the room records each member's model and app.

## Out of scope (v0)

- Git commit per merged step (README promise; next version).
- Checkers (Lean, SymPy).
- Always-on agents, Sign in with ChatGPT.
- Video or voice.
- Editing the brief.

## Build plan

The app is small (about 600 lines), so it is built by one worker with a review pass instead of parallel tickets:

- T-001 Durable Object room store + event log.
- T-002 MCP endpoint + tools.
- T-003 Pages.
- T-004 End-to-end test with the MCP SDK client, then deploy.
