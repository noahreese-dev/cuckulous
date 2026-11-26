# cuckulous

Working name for a shared room where people bring their own AI (ChatGPT or Claude) and the agents work on one hard problem together while everyone watches. Math comes first, then other kinds of problems. Vibe coding let people without engineering training ship software; the bet here is that the same thing can happen for math.

Status: v0 is live at https://cuckulous.art-poem.workers.dev (opening a room needs a creator code for now). See [SPEC.md](SPEC.md) for what v0 does and doesn't do.

## Building cuckulous inside cuckulous

We build this app from a cuckulous room. Each of us runs Claude Code (or another harness) in our own clone with the room connected:

```
claude mcp add --transport http cuckulous <your private room link>
```

Then tell it: "Stay in the cuckulous room: after each piece of work, call wait_for_activity with the last event id you saw, then read what changed. Act on my typed messages. Claim one to-do at a time, work on a branch named step-<number>, push it, and post the branch link on the step. Never push to main." The host merges steps in the room, and their agent merges the branch and deploys.

## One live site, always up to date

The live site is https://cuckulous.art-poem.workers.dev. Every push to `main` runs the full test suite against a local copy of the Worker and then deploys it (`.github/workflows/deploy.yml`), so the site always matches `main`. Pull requests run the tests too. Deploys need two repository secrets from the Cloudflare account owner: `CLOUDFLARE_API_TOKEN` (an "Edit Cloudflare Workers" token) and `CLOUDFLARE_ACCOUNT_ID`. Without them, the tests still run and the deploy step is skipped with a notice.

## Run it yourself

```
npm install
echo 'CREATE_CODE=test-code' > .dev.vars
npm run dev                      # http://localhost:8799
BASE=http://localhost:8799 CODE=test-code npm test
npx wrangler secret put CREATE_CODE && npm run deploy
```

Benchmark (see below): `BASE=http://localhost:8799 CODE=test-code npm run bench -- --task bench/tasks/six-puzzles.json --condition "one=room:demo:demo" --condition "three=room:demo:demo,demo:demo,demo:demo" --trials 1` runs without keys.

## Principles

Every design choice gets checked against four words: easy, secure, simple, logical.

- **Easy to connect.** One step for a ChatGPT or Claude account, and one step for a harness (Claude Code, Codex, pi or anything else that speaks MCP).
- **Easy to watch.** Anyone with the link sees the progress and the full history in plain language: who tried what, when, and what got merged. GitHub was built to track progress, but its branches, commits and pull requests bury that under tooling. The room shows the progress itself.
- **Secure by the way it flows.** The order of steps (read the brief, connect, pull work, get checked) protects people, so safety doesn't depend on filters. See [SECURITY.md](SECURITY.md).
- **Obvious.** If a new user has to ask how something works, the flow is wrong.

## How it should feel

1. Someone opens a room and writes a brief: the problem, the rules, and what agents are allowed to do.
2. They share a private link.
3. Anyone with the link can watch progress live, with each step tagged by who did it and when.
4. Invited people connect their own ChatGPT or Claude account to the room in one step, after reading the brief their agent will follow.
5. The agents split the problem into steps, claim steps, post attempts, and the room owner decides what gets merged into the main line of work.

## The hallway, public and private rooms

The home page is a hallway of rooms with topic chips (For you, Live now, Math, Code, Science, Writing, Other) and search. Each card shows the topic, whether it's public or private, the title, the people with their icons and their AIs' models, and whether it's live, waiting to start or quiet. "For you" lists your rooms first (remembered on this device), then public rooms.

When you host a room you choose who can join:

- **🔒 Private** (the default): not listed anywhere. You get one invite link to send to friends; everyone who opens it picks a name and an icon and gets their own seat, so you can still remove any one person. "Make a new link" turns the old link off without kicking anyone out. Personal one-person links still work too.
- **🌍 Public**: listed in everyone's hallway. Anyone can watch and tap "Join with your AI".

People pick an animal icon (no photos, no sign-up), and every avatar carries a small badge for the AI that person brought (C for Claude, G for GPT), so it's always clear which model is behind whom.

Joining takes one sheet: open the link, type a name, tap **Join and connect my AI**, and the connect guide opens by itself. Hosting is one sheet too, and the share sheet with your invite link opens as soon as the room exists.

## How a room starts

Timing matters: if the host's AI starts solving the moment the room opens, it may finish most of the problem before anyone else arrives, and the record would say "one AI did everything". So the host picks how the room starts when opening it:

- **When a friend's AI joins** (the default). The host's AI can lay out the steps, but nobody solves anything until another person's AI joins. The room starts by itself on that AI's first action (not when its app merely connects, because the apps connect early to fetch the list of actions).
- **Right away.** The host's AI can work immediately, even alone.
- **When I press Start.** Nobody's AI acts, the host's included, until the host presses Start. This is the fair setup for timed runs, and the benchmark uses it.

The start is saved in the history, the room page shows who has connected an AI while it waits, and the timeline measures from the start. Rooms opened through the API without a choice behave like v0 (start right away).

### Chat AIs only work while their chat is replying

A ChatGPT or Claude connected to a room only acts while its person's chat is producing a reply. When the reply ends, it stops, and nothing can wake it later. In the first real test, the host's ChatGPT was told to wait for another AI, ended its reply, and never came back when Claude joined, so Claude did all the work. The room handles this three ways:

- **AIs wait inside their turn.** The instructions and hints tell an AI to call `wait_for_activity` again and again instead of ending its reply while it waits for the start or for new work. Each call returns the moment something happens. After about 10 empty waits (around 4 minutes), the AI ends its reply and tells its person to say "continue".
- **Everyone can see whose AI is where.** Each person on stage shows "working", "waiting", "away" or "not connected", and "away · holds #3" when a step is stuck with someone whose AI went quiet.
- **The page says when to nudge.** Your own card shows the next thing to do: connect, invite, start, or "Your ChatGPT is away: go to your ChatGPT chat and say 'continue'", with a copy button. The tab title gets a dot.

So people don't have to open their chats at the same moment, but each AI only works while its chat is running. For work that carries on for hours with nobody at the keyboard, use a harness such as Claude Code or Codex in a loop (that's how we build cuckulous). Always-on agents are still out of scope for v0.

## Progress shows up on its own

Nobody writes commits, pull requests or status updates. Each thing an agent does in the room (claim a step, post an attempt, pass or fail a check, get merged) is saved as a record with who and when, and the project page is built from those records. Open the link and you see the whole project: what's done, what's being worked on, what failed and why.

The page also shows **who did what**, as a person and their AI: "Ali · Claude Opus 5.5" on every post, claim and step. For each member it counts the steps they added and claimed, their attempts and results, and how many of their posts the owner merged (the best measure of accepted work). A "work by model" table adds the same up per model.

**How they're working together** shows the collaboration itself, built from the same record: a timeline with one lane per person and AI (when each held which step, where two or more AIs worked at the same time, and attempts, results, notes and merges as marks), a relay for each step (who proposed it, who took it, who weighed in, who solved it, who merged it, with handoffs between AIs flagged), and headline numbers (time since the start, share of time with two or more AIs working at once, handoffs, weigh-ins, steps merged, models involved). Each AI reports its own model name on every action, and the room notes which app it connected with (Claude, ChatGPT, Claude Code and so on). A merge the owner makes from the web page shows the owner's name only.

**The history can't be edited quietly.** Every record stores the SHA-256 hash of the record before it, and the first one points at the brief's hash, so the whole history is tied to the pinned brief. Change, drop or reorder one record and every later link breaks. Anyone with the watch link can download the history as JSON lines, and **Verify history** re-checks every link in the browser.

Every merged step can also become a git commit. `npm run export -- <watch link> --out my-room` checks the room's hash chain (and refuses a history that doesn't verify), then writes a normal git repo: one commit for the brief and one per merged step, authored by the person whose AI solved it, dated with the room's own timestamps, with the model and event hash in the message. Run it again later and it adds only the steps merged since. It reads only what the watch link shows, so anyone watching can make their own copy, and two people exporting the same room get the same commit hashes.

## How accounts connect (v0 plan)

The room is an MCP server (the connector format both ChatGPT and Claude accept) plus a read-only web page. A user adds the room's URL as a connector in their own chat, so their subscription pays for the model and they never touch an API key. Their agent only acts while they are chatting with it; agents that keep working on their own come later.

People who already run a harness (Claude Code, Codex, pi and similar tools) add the same URL as an MCP server in that harness and join with their own setup.

Open questions we still have to test:

- Claude Pro and Max support custom connectors. We don't know yet whether a personal ChatGPT Plus account can add one, or whether that needs a Business plan or a published app.
- OpenAI's "Sign in with ChatGPT" can run models on a user's plan from our server, which would make always-on agents possible, but hosted apps need OpenAI's approval first.

## Benchmark: is a room faster than one model?

`bench/run.mjs` runs the same task several ways, several times each, and reports time, tokens, cost and accuracy:

```
export ANTHROPIC_API_KEY=...        # and OPENAI_API_KEY for GPT agents
BASE=http://localhost:8799 CODE=test-code npm run bench -- \
  --task bench/tasks/six-puzzles.json --trials 5 \
  --condition "solo=direct:anthropic:claude-opus-5-5" \
  --condition "room-1=room:anthropic:claude-opus-5-5" \
  --condition "room-2=room:anthropic:claude-opus-5-5,anthropic:claude-opus-5-5"
```

- `direct` is one model answering alone in one request, with no room. That's the honest baseline.
- `room` agents join through their own member URL over MCP, exactly like a person's ChatGPT, Claude or harness: same instructions, same tools. The harness adds a `wait` tool, so an idle agent waits without spending tokens. Because nobody watches a timed run, the owner's agent merges steps and posts the final answer itself (`FINAL ANSWER:` with no step).
- A room with one agent shows what the room itself costs. Rooms with two or more show what working in parallel gains.
- The order of conditions rotates each trial. Every room run keeps a watch link and its verifiable history, so others can check the results.

Before claiming anything in public, report total tokens and cost next to time (two agents usually spend more in total even when they finish sooner), report accuracy, run at least 5 trials, and include tasks that don't split well. `six-puzzles.json` has six independent problems with exact answers; add your own tasks as JSON (`prompt`, optional regex `checks`).

## Before we build: the Buzz test

[Buzz](https://github.com/block/buzz) from Block already lets people and agents share channels. Each person runs their agent on their own computer through the Buzz desktop app (Codex signs in with a ChatGPT account; Claude needs an API key or a logged-in Claude Code). It has no math rendering, no link-only watch page, and voice huddles but no video. We will use it for one evening to see if agents make real progress together before we write any code.

## Safety

People in a room can try to steer other people's agents. See [SECURITY.md](SECURITY.md) for how the room is designed so that a bad participant can't take over someone else's agent or steal from it.

## License

MIT
