# CLAUDE.md — ניהול מעבר דירה (afula-move)

A Hebrew, RTL, dependency-free web app for planning an apartment move.
Live at **https://colorbull.github.io/afula-move/** · repo `ColorBull/afula-move`.

`README.md` is the user-facing doc, in Hebrew. This file is the working doc for Claude.

---

## Ground rules

- **No Node.js on this machine.** No `npm`, `npx`, or any build toolchain. Python 3.13 only.
  Never propose a solution that needs a bundler, a package, or a framework.
- **Zero dependencies, zero build step for development.** The app is three files loaded by
  three classic `<script>`/`<link>` tags. Keep it that way.
- **Free hosting only.** GitHub Pages + the Firebase free tier. Nothing that bills.
- **Claude deploys.** The user does not want to run commands or copy files; do the whole
  build-and-publish loop directly.
- **All user-visible text is Hebrew.** Code comments are Hebrew too — match the surrounding
  style rather than switching to English.

---

## Files

| File | Role |
|---|---|
| `index.html` | 50-line shell: topbar, search bar, `#drawer`, `#scrim`, `#views`, `#overlay`, `#toast`. Rarely changes. |
| `app.js` | Everything. ~2000 lines, one IIFE. |
| `data.js` | `TABS`, `PHASES`, `ROOMS`, `BOX_STATUS`, `SERVICE_STATUS`, `SHOP_AREAS`, `SHOP_PRIO`, `DOC_TYPES`, and all `SEED_*` lists. Plain globals. |
| `styles.css` | Light/dark, RTL, mobile-first. |
| `build_single.py` | → `index-single.html`, the deployable artifact. Firebase **on**. |
| `build_artifact.py` | → `afula-move-app.html`, for a claude.ai Artifact. Firebase **off** (`ARTIFACT_MODE`), no external refs at all. |
| `sw.js`, `manifest.json`, `icon.svg` | PWA. Only used by the multi-file version. |
| `firestore.rules` | `moves/{uid}` readable/writable only by that uid; everything else denied. |
| `mcp-server/afula_mcp.py` | Python MCP server that talks to the same Firestore doc, so Claude Desktop can read and edit the move. |
| `graph.html` | Standalone side page. Not part of the app. |

---

## Architecture

- `app.js` is wrapped in `(function () { ... })();`. **Nothing is reachable from the console** —
  when testing in a browser you cannot poke at `state` or call internals. See *Testing* below.
- One in-memory `state` object; every mutation calls `save()` then `render()`, which rebuilds
  `#views` wholesale from `VIEWS[view]()`. There is no diffing and no component model.
- Event handling is **delegation on `document`**: `[data-tab]` for navigation, `[data-act]` for
  actions, `[data-coll][data-id][data-field]` for inline edits. A new feature usually needs a
  render function plus one `act` case — no new listeners.
- `render()` preserves scroll position when the view didn't change, so deleting a row doesn't
  throw the user to the top.
- Collections: `tasks`, `shopping`, `boxes`, `budget`, `services`, `docs`, `contacts`
  (+ `settings`, `shopAreas`, `budgetSections`).
- `loadLocal()` safe-merges saved data against `defaultState()`. **When adding a collection or a
  settings field, add it there too**, or existing users lose data on upgrade.
- `state.updatedAt` starts at `0` deliberately: a fresh empty device must never win the
  last-write-wins race against the cloud copy.

### Sync

Firestore doc `moves/{uid}` = `{ payload: "<state as JSON>", updatedAt: <ms epoch> }`.
Google OAuth only — anonymous login was explicitly rejected. Pushes are debounced 700ms.

The Firebase web API key in `app.js` is **public by design**. Protection comes from the
Firestore rules plus an HTTP-referrer restriction (`colorbull.github.io/*`,
`afula-move.firebaseapp.com/*`, `localhost/*`). Do not treat GitHub's secret-scanning alert
about it as a real leak — this is documented in the README.

The Firebase **service-account JSON** is a genuine secret. It lives at
`mcp-server/service-account.json`, is gitignored, and must never enter the repo.

### Google Calendar

Two manual buttons, both explicit. Scope is `calendar.app.created`, so the app only ever sees
the calendar it created itself.

The push and the pull must stay compatible: **push only manages events tagged with
`extendedProperties.private.afulaTaskId`.** An untagged event is a hand-made one — push leaves
it alone, and pull turns it into a task and tags it. If you ever make push delete untagged
events again, it will silently destroy the user's own calendar entries.

### Sort, filter, drag

`SORTS` maps each view to its sort options; `'manual'` is always first. Drag-and-drop is
Pointer Events based and only active under `'manual'` — other sorts render a static, dimmed
handle and a hint. `applyOrder()` rewrites items **into the slots the dragged group already
occupied**, which is what enforces "reorder within a section only, never across".

The row number *is* the drag handle (`.rank`), on **every** list — tasks, shopping, boxes,
budget, services, docs, contacts. There are no reorder arrows and no separate `⠿` grip; the
old `grip()` helper is gone. `rank(i, manual)` renders a `<button data-grip>` under manual
sort and a dimmed `<span class="rank static">` otherwise.

`toolbar()` renders every screen's sort **and** filters in one card, plus a
`נקה סינונים 🧹` button (`data-act="clear-filters"`) that drops the sort, the filters and the
global search for that view. Tasks has no separate filter card — phase and state are ordinary
`filterBy.tasks.phase` / `.state` entries.

### View state across reloads

`LS_UI` (`afula_move_ui`) keeps `{view, sortBy, filterBy}` in localStorage, written by
`saveUI()` at the end of every `render()` and read by `loadUI()` at init. It is **display state
for this device only** and deliberately does not go through `state`/Firestore — otherwise
one device's open filter would follow the user to another.

### Links on items

Shopping items and docs carry a `link` field behind a single button (`linkBtn()`): short click
opens it, long press (550ms) opens `prompt()` to paste or clear it. The `linkPress.fired` flag
suppresses the click that browsers fire after a long press. There is no visible URL input —
a full-width link field ate a row and showed text nobody reads.

### Date fields

`<input type="date">` renders its text in the **browser's own locale**, not the page's
`lang="he"` — so the same task showed `21/08/2026` on a Hebrew desktop and `08/21/2026` on an
English-language phone. The format cannot be overridden. `dateField(value, attrs)` wraps the
input in `.datef` and paints our own `dd/mm/yyyy` label (`.dtxt`) over the native text, which
is made `color:transparent`. The input itself stays in flow, keeps its native width and its
calendar button, and still stores plain ISO. On mouse + fine-pointer devices the native text
comes back on `:focus` so keyboard entry stays visible; on touch it never does.

The label is re-synced by `syncDateText()` from capture-phase `input`/`change` listeners, not
by `render()` — the settings sheet has a date field with no re-render behind it.

Use `dateField()` for **every** new date field; a bare `<input type="date">` reintroduces the
split. `fmtDateNum()` formats straight off the ISO string, deliberately avoiding `Intl` and
`Date` so neither system language nor timezone can shift it.

### Live totals

`refreshTotals()` rewrites every `[data-total="source:field[:id]"]` element in place on `input`,
so the budget and shopping sums update while typing without a re-render stealing focus.
Sources: `bg` (budgetStats), `sh` (shopStats), `bsec` (sectionStats), `ssec` (areaStats).

---

## Build and deploy

There are **two** environments, and they publish differently. Work out which one you are in
before doing anything: if `git remote -v` prints a remote, you are in a Claude Code session.

### In a Claude Code session — plain git, no web editor

The source lives under `src/`, and the remote works. The whole loop:

```bash
cd src && PYTHONIOENCODING=utf-8 python3 build_single.py && cp index-single.html ../index.html
cd .. && git add -A && git commit -m "…" && git push -u origin <branch>
```

Then open a PR and merge to `main` — Pages serves the root `index.html` from `main`, so a
commit on a feature branch is not live yet.

A `403` with *"Claude doesn't have GitHub access to ColorBull/afula-move for your
organization"* on push is an authorization gap, not a network error: retrying will not fix it.
The user has to install the GitHub App or reconnect GitHub from claude.ai settings. Do not
fall back to the web-editor flow below — hand them the built file and wait.

### On the user's own machine — web editor

Source files sit at the repo root there, not under `src/`, and **that clone has no git
remote**: commits are history-keeping only and never reach GitHub.

```bash
cd "G:/My Drive/05_AI/Claude/Code/afula-move" && PYTHONIOENCODING=utf-8 python build_single.py
powershell -c "Get-Content -Raw -Encoding UTF8 index-single.html | Set-Clipboard"
```

`PYTHONIOENCODING=utf-8` is required — the script prints Hebrew and Windows' default codepage
raises `UnicodeEncodeError` without it. Then paste over
https://github.com/ColorBull/afula-move/edit/main/index.html

When driving the GitHub web editor: **wait for the commit dialog to actually open and confirm
it with a screenshot before typing the commit message.** Batching the click with the typing
once dumped the message into the code editor and corrupted the file.

### `index.html` means two different things

In `src/` (and at the root of the user's own clone) it is the 50-line shell. At the root of
**this repo** it is the full inlined single-file build. Never commit the shell over the root
build, and never copy the root build back into `src/`.

`index-single.html` is gitignored — it is a build output, rebuilt on demand.

### The commit is not the deploy

**A green commit does not mean the site updated.** Committing `index.html` only triggers the
`pages build and deployment` workflow; that workflow can fail or sit queued on GitHub's side
long after the commit succeeded. Always verify the live URL before telling the user it's out:

```bash
curl -s "https://colorbull.github.io/afula-move/?cb=$(date +%s)" | wc -c
```

Compare against `wc -c index-single.html`, or grep for a string only the new build contains.
The published page is one file, so byte count is a reliable fingerprint.

If it doesn't match, check https://github.com/ColorBull/afula-move/actions. Seen in practice:
`build` passes, `deploy` fails in a few seconds with `Failed to create deployment (status: 503)`
/ `No server is currently available`, which is a Pages outage and nothing to do with the file.
`Re-run jobs → Re-run failed jobs` is the fix, but during an incident the re-run just queues —
confirm with `curl -s https://www.githubstatus.com/api/v2/summary.json`. Wait it out; do not
re-paste the file, and do not assume the content was at fault.

---

## Local testing

```bash
python -m http.server 5178
```

(also wired as `.claude/launch.json`, name `afula-move`).

- `file://` will not work — the app needs `http` for the service worker and for module-free
  script loading to behave consistently.
- Because everything is inside an IIFE, testing internals means building a throwaway harness:
  fetch `app.js`, splice a `window.__t = { ... }` export in before the final `})();`, and eval
  it. That is how the calendar sync was tested against a stubbed `gcalFetch` without a real
  OAuth round trip. Delete the harness afterwards.
- **The Browser pane does not composite frames.** CSS transitions freeze mid-animation, so
  measurements taken while the drawer is "opening" are garbage and screenshots can time out.
  Inject `* { transition: none !important }` before measuring.
- Stale service workers and cached CSS bite constantly. Unregister all SWs, clear caches, and
  cache-bust the stylesheet `href` with `?v=` when a CSS change appears not to apply.

---

## CSS notes

- **RTL logical properties are the #1 source of bugs here.** In `dir="rtl"`:
  `inline-start` = **right**, `inline-end` = **left**. The drawer sits at `right: 0`, so keeping
  content clear of it means `padding-inline-start`, not `-end`.
- The desktop pinned drawer must **not shift the page**. Content narrows symmetrically via
  `max-width: min(900px, calc(100vw - 580px))` on `.views` so its centre never moves. The pin
  threshold is `min-width: 1024px`; below that the drawer overlays like on mobile, because
  there isn't room to keep content both centred and clear of a 270px drawer.
- `--topbar-h` is measured at runtime by `syncTopbarHeight()` and written to
  `document.documentElement`. It keeps the drawer header's bottom border on the same line as
  the top bar's at any font size. Re-measure on resize.
- Absolutely positioned elements resolve `left: 50%` against the containing block's *padding
  box*, so padding on `.topbar` does not move the absolutely centred brand.
- On mobile, `input[type=date]` has a large intrinsic minimum width in Chrome and will force a
  row onto a second line. Fix with `flex: 1 1 0; min-width: 0`, not by shrinking fonts.

---

## Known, accepted

- The live site logs a 404 for `sw.js`. The published artifact is one self-contained HTML file,
  so `sw.js` was never deployed beside it. The registration is `.catch()`-wrapped and nothing
  breaks. Offered to silence it; the user hasn't asked.
- Firestore sync can only be verified from an `https` origin with a real Google account, so it
  is not testable from `localhost` in the usual loop.
