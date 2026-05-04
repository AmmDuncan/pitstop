# Pitstop · social media slides — brief for Claude design

You are designing a social-media carousel for **pitstop** — an open-source agent-driven review tool. Two deliverables: a **LinkedIn** post and an **Instagram** post. Same story, different shape per platform.

## What pitstop is (in one sentence)

A drawer that mounts in your dev app's browser where your AI agent leaves you items to review; you respond with a single keystroke or a comment, and the agent picks up the response and drives you through the next surface.

## Audience

Developers who already use AI coding agents (Claude Code / Cursor / Copilot Chat). The kind of person who spent the last six months realising their agent could ship more than they could review.

The hook isn't "look at this cool tool" — it's "here's the missing half of the loop."

## Voice / tone

- Confident, dry, technical. No marketing fluff, no exclamation marks, no "🚀".
- Self-aware that this is one of many tools in this space; trust the audience to pattern-match.
- Avoid "AI does X for you!" framing. Lean into "AI does X — *you* still own the call."

## Brand visuals

Pitstop's UI is "Mono Industrial":

- **Backgrounds**: deep ink (`oklch(15% 0.02 240)` ish — near-black blue-grey), with a subtle 14px dot grid.
- **Type**: monospace for chrome / labels (think Berkeley Mono, JetBrains Mono); sans for body copy (Inter / similar).
- **Accent**: amber (`oklch(78% 0.16 80)` — golden yellow-orange). One accent only.
- **Semantic colors**: green for "tested", red for "concerns" — used as 2px left-rail accents on otherwise-neutral panels, not as fills.
- **Spacing**: 14px grid. Generous whitespace. Tight letter-spacing on uppercase mono labels (~0.18em).
- **Borders**: 1px hairlines, low-contrast neutral grey. No drop shadows except on "floating" UI.

Keep slides on-brand: same palette, same typography, same restraint. The vibe is "code editor at 10pm" not "SaaS landing page".

## Reference assets

- Live drawer screenshots are at `/tmp/feed-collapsed.png` and `/tmp/feed-expanded.png` (or screenshot the drawer fresh from `http://localhost:7773/demo` after a `start_review`).
- README and CHANGELOG at `https://github.com/AmmDuncan/pitstop` — pull product copy from there for accuracy.
- Drawer's actual CSS palette is in `packages/inject/src/styles/tokens.css` — match the slide palette to those tokens.

## Story arc (use across both platforms; vary slide count)

1. **Hook** — *"Your agent ships faster than you can review."*
   Set up the tension: you've been losing context in chat scrollback.
2. **The drawer** — One screenshot of the drawer with three structured items (lookFor / tested / concerns / question). Caption: *"What if the review came to you, on the surface where the change lives?"*
3. **One keystroke** — Show the keyboard shortcuts: `⏎` approve, `c` comment, `⌘↵` send. Caption: *"Approve in one keypress. Comment when it's not."*
4. **The agent waits** — Show the AgentFeed area with three "CLAUDE: …" status lines. Caption: *"The agent narrates what it's doing. When you respond, it picks up the next surface and drives you there."*
5. **Wiring** — Three options (`wire_drawer` snippet committed / local-only / extension). Caption: *"One MCP call wires it into your dev app. Local-only or committed — your call."*
6. **Architecture** — A simple block diagram: `Claude Code → MCP → daemon → drawer in your browser`. Tiny. Don't over-explain.
7. **Open source** — *"github.com/AmmDuncan/pitstop · MIT · Bun + TypeScript + Solid.js · v0.3.1"*
8. **CTA** — *"Try it: clone, `bun run setup`, restart Claude Code, ask it to start a review."* Or for Instagram: a single QR code to the GitHub repo.

## Per-platform sizing

- **LinkedIn carousel**: 1080×1350 (4:5), 7 slides. Body copy can run to ~30 words per slide. Slide 1 is the hook + a single screenshot. Slides 2-6 each take one beat from the arc above. Slide 7 is the CTA.
- **Instagram carousel**: 1080×1080 (1:1), 8-10 slides. Body copy max ~15 words per slide; lean on visuals. Slide 1 is hook only (oversized type, no screenshot). The screenshot lands on slide 2. Slide 10 is the QR code + handle.

## What to avoid

- Don't pitch the AI bit hard. The audience knows. Lead with the workflow problem.
- Don't show curl commands or code blocks unless they're aesthetically part of the slide (e.g. one beautifully-set Bash one-liner on a darker slide for texture). Don't do walls of code.
- Don't promise productivity gains in numbers ("3x faster!"). The audience will dismiss it.
- Don't use generic stock-photo developers. If you need humans, draw simple line illustrations.

## Output

Two PNG sequences:

- `social/linkedin/slide-01.png` ... `slide-07.png` (1080×1350)
- `social/instagram/slide-01.png` ... `slide-10.png` (1080×1080)

Plus a `social/captions.md` with the suggested post copy for each platform — one paragraph for LinkedIn (longer, conversational), three lines + 5 hashtags for Instagram (`#ai`, `#claudecode`, `#devtools`, `#opensource`, `#frontend` are reasonable starters; tune as you see fit).

## One-line summary for the slide author

> *"Make a developer who's tired of reading AI chat scrollback feel seen — then show them the drawer where their reviews actually happen, and the one keystroke it takes to respond."*
