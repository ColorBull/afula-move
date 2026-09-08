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
| `app.js` | Everything *except* the money/grouping math. ~2100 lines, one IIFE. |
| `calc.js` | Pure functions — `AfulaCalc`. All budget/shopping math, the unknown-value grouping, and the services-alert text. No DOM, no globals. Loaded **before** `app.js`; `app.js` keeps thin wrappers (`var C = AfulaCalc;`). |
| `data.js` | `TABS`, `PHASES`, `ROOMS`, `BOX_STATUS`, `SERVICE_STATUS`, `SHOP_AREAS`, `SHOP_PRIO`, `DOC_TYPES`, and all `SEED_*` lists. Plain globals. |
| `styles.css` | Light/dark, RTL, mobile-first. `.shopmeta` is a **grid**, not flex — see *Field rows* below. |
| `build_single.py` | → `index-single.html`, the deployable artifact. Firebase **on**. |
| `build_artifact.py` | → `afula-move-app.html`, for a claude.ai Artifact. Firebase **off** (`ARTIFACT_MODE`), no external refs at all. |
| `sw.js`, `manifest.json`, `icon.svg` | PWA. Only used by the multi-file version. |
| `firestore.rules` | `moves/{uid}` readable/writable only by that uid; everything else denied. |
| `mcp-server/afula_mcp.py` | Python MCP server that talks to the same Firestore doc, so Claude Desktop can read and edit the move. Runs **locally, over stdio**. See *MCP server* below. |
| `tests.html`, `tests.js` | Unit tests for `calc.js`. Open `http://localhost:5178/tests.html` — green box = all pass. No runner, no packages. |
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

### Money: two units, never summed

`once` sections are **shekels**; `recurring` sections are **shekels per month**. Adding them
produced the app's worst bug (a "17,495 planned / 14,300 free" figure that meant nothing).
`AfulaCalc.budgetStats()` therefore returns two disjoint objects, `once` and `monthly`, with
no shared arithmetic and no combined total. `moneyCards()` in `app.js` renders them as two
separate cards on both the Budget and the Overview screen, each with its own over/under badge.
**Never add a field that spans them.**

Shopping `cost` rolls into `once.actual` (`once.shoppingActual`), counted exactly once and
attributed to no budget row — the card says so in words. `gift: true` means the item arrived
without money changing hands, and it is therefore **out of every money calculation** — not the
estimate and not the actual. `shopStats` skips gifts when summing `est` / `estCount` (and keeps
them out of `estScope`, the coverage denominator); `areaStats` skips them too; `itemSpend()`
already returned 0. On the row itself both the משוער and the שולם inputs are disabled and show
`—`, so the exclusion is visible rather than silent — the stored values survive, so unticking 🎁
brings them back.

A gift therefore does **not** qualify the once-badge: it stays the green ✅ and says nothing
about the gift. An earlier version turned the badge yellow (ℹ️) and appended
"פריט אחד התקבל במתנה ואינו חיסכון מול התכנון"; the user read the colour as "something is wrong"
and the sentence as the app telling them what they had just told it. Only `unknownCost` —
`bought && !gift && cost <= 0`, "price never entered" — drops the ✅, because that one really
does make the remainder untrustworthy. It is a data-quality warning, never spend.

🎁 and the `bought` checkbox move together **in both directions**: ticking 🎁 sets `bought`,
unticking 🎁 clears it, and unticking `bought` clears `gift`. The half-state that used to
survive — `gift:false, bought:true, cost:0` — is exactly what `isCostUnknown()` reads as
"price never entered", so cancelling a gift silently raised a data-quality warning about an
item the user had just said they did *not* have.

### The screen must not jump under the finger

`render()` rebuilds `#views` wholesale, so restoring `window.scrollY` is not enough: ticking a
row can add or remove a warning line in the summary card *above* the viewport, and everything
below then shifts by tens of pixels. `scrollAnchor()` records the first `[data-drag-item]` still
visible and its distance from the top of the window; after the rebuild `render()` restores
`keepY` and then `scrollBy`s the difference, so that row lands back on the same pixel. Anything
that changes the height of content above the fold needs this — do not replace it with a plain
`scrollTo(keepY)`.

`gift` is toggled by the 🎁 icon on the item's title line, next to 🔗 and ✕ — deliberately
outside the `.shopmeta` grid, because it is a state of the whole item, not another field. There is no
"מתנה" tag and no "מחיר לא נרשם" tag; the earlier version had both and they read as noise
next to the controls that already say it. The two flags stay consistent in both directions:
ticking 🎁 sets `bought`, unticking `bought` clears `gift`, and `AfulaCalc.isBought()` counts
`gift` as bought so a record written elsewhere (the MCP server) can't land in a half-state.

### Two kinds of `.task` row

`.task` is used for two different shapes. The full one (Tasks / Shopping / Budget) has a
`.rank`, a `textarea.title` and a `.meta` / `.shopmeta` row. The Overview screen reuses the
class for a much simpler row — a title `<div>` plus one `.small muted` line — and those are
marked **`.task.lite`**.

The `@media(max-width:520px)` rule turns `.task` into a grid and its `.t` into
`display:contents`, which only makes sense for the full shape. Applied to a lite row it threw
the title and the sub-line into `auto` columns: the title stopped wrapping and the **whole page
gained a horizontal scrollbar** — the phone screen slid sideways and exposed the closed drawer.
The rule is therefore written `.task:not(.lite)`. A new Overview-style row must carry `lite`.

### Mobile text must never be cut mid-word

Every field row that holds a `<select>` sizes its columns in **`em`, not `px` or a fixed
count**, so the layout reacts to the phone's own text-size setting as well as to its width.
`.shopmeta.buy` / `.shopmeta.bud` use
`grid-template-columns: repeat(auto-fit, minmax(8.5em, 1fr))` below 820px; the box card's
`.line` is `flex-wrap: wrap` with `flex: 1 1 6em` on each `<select>` and `min-width: 0` so a
long option cannot widen the card. Below 520px the box's number badge and padding shrink, which
is what buys חדר שינה ← חדר עבודה enough room to stay on one line.

A fixed `repeat(3,1fr)` was there before and clipped ליום הראשון to ליום הראשו on the
user's phone. A `<select>` cannot wrap or ellipsize its own text — it just cuts — so the only
fix is to give it the width, or let it drop to its own row. Never reintroduce a fixed column
count for these rows, and after any change to them re-run the width check described in
*Local testing*.

### The box number *is* its position

`x.num` is maintained as the box's index in `state.boxes` + 1, by `renumberBoxes()`, which runs
after every add, delete and drag-reorder. Reordering the list therefore reprints different
numbers — that is deliberate: the user wants the label to match what the screen shows, not the
order the boxes happened to be created in. New boxes are `push`ed to the end (not `unshift`ed to
the front) so adding one never shifts the numbers already stuck on boxes.

The card shows that number through `rank(i, manual, x.num)` — the third argument overrides the
display index, so the number stays correct even when a filter hides rows. There is no separate
number badge; the row number is the only number on screen.

`printLabels(list)` prints all boxes when called with nothing, and exactly one when called with
`[box]` — the 🖨️ button on each card (`data-act="print-label"`) alongside the bulk
תוויות button.

The box card has **no tag row**. The status tag repeated the status `<select>` sitting directly
above it and the red שביר tag repeated its own checkbox; both read as noise next to the
control that already says it — the same reason the מתנה tag is gone from shopping rows.

### Nothing vanishes on an unrecognised value

A `shopping.area`, `tasks.phase`, `budget.section`, `boxes.status`, `services.status` or
`docs.type` outside the known list must never drop the record from the UI. Grouped screens
render a trailing group (`ללא אזור`, `ללא שלב`, `ללא קטגוריה`) that is included in every total,
counter and filter; every `<select>` uses `optsWith()`, which prepends the raw value as
`X (לא מוכר)` so editing another field cannot silently clobber it. Filters are built with
`enumFilterOpts()`, which appends whatever values actually exist in the data.

### Field rows line up

`.shopmeta` (the small fields under an item's name, on both Shopping and Budget) is a CSS
**grid** with an explicit column template, not `flex-wrap`. Under flex each row divided the
width by its own content, so no two rows' columns were ever aligned. Two variants:
`.shopmeta.buy` (עדיפות · משוער · שולם · חנות · קטגוריה · קישור) and `.shopmeta.bud`
(מתוכנן · בפועל · קטגוריה · ספק). Adding or removing a field means updating that template.
Below 820px it becomes 3 columns with the link button spanning the full width; below 520px,
2 wide columns — at 3 the `<select>`s clip ("אמבטיה ושירותים"), and an extra row beats
truncated text.

### No hardcoded domain facts

The UI must not assert anything about this move that is not in Firestore. The Overview
services alert is generated entirely from the open `services` records: the names come from the
records, the urgency clause from `move_date` minus today (weeks / days / today / past), and the
lead-time guidance from each record's own `notes`. It hides itself when nothing is open.
The previous version named "חשמל, מים, ארנונה ואינטרנט" from a string literal — three of those
are not records at all, and for this user never will be (water/arnona/building fees are in the
rent; electricity is reimbursed to the landlord). Do not reintroduce utility names, provider
names, assumed lead times or assumed costs anywhere in `app.js`.

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

Each shopping category and each budget section carries its own **➕ פריט חדש / ➕ סעיף חדש**
button in its footer (`add-shop-in` with `data-area`, `add-budget` with `data-section`). They
create an empty row inside that group and, for shopping, move focus to the new name field —
the point is not to scroll back to the form at the top of the screen for a local addition. A
group with no items renders no card and therefore no button; the form at the top is still the
way to fill an empty category.

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

### פריט חדש בזמן שסינון פעיל

A record is born empty, so with a filter on the screen it almost never matches it: it is
saved, it is simply not shown, and the button looks broken. `applyFilterDefaults(view, obj,
preset)` therefore writes the active filter values **into the new record** before it is pushed
— `NEW_FROM_FILTER` maps each filter key to a `{set, has}` pair per view. A filter that cannot
be expressed as a value ("עם קישור", "באיחור", "בחריגה מהמתוכנן") is **cleared instead**, and so is
the global search — free text never matches an empty row. `preset` lists the fields the form
above the list already chose (`phase`, `area`, `prio`, `to`, `role`): those are never
overwritten, and if the user's own choice conflicts with the filter it is the *filter* that
goes. When anything was cleared the toast says so (`FILT_CLEARED`) instead of the usual
"נוסף", because the screen visibly changed.

Adding a filter to a view means adding its key to `NEW_FROM_FILTER` too — an unmapped key is
treated as unsatisfiable and simply gets cleared.

### סיכום לפי הסינון במסך הקניות

When a shopping filter is active, a card under the list totals **only what is shown** — the
practical question behind "רק איקאה" is how much that shop costs, not the grand total. The
predicate lives in one place, `shopFilterPass()`, used both by `viewShopping()` and by
`refreshTotals()` (source `sfil`), so the sums move while typing. `AfulaCalc.listStats(list)`
sums any list of shopping items; `areaStats()` is now a thin filter over it. The card is
hidden with no filter, so it never duplicates the card at the top of the screen.

### View state across reloads

`LS_UI` (`afula_move_ui`) keeps `{view, sortBy, filterBy}` in localStorage, written by
`saveUI()` at the end of every `render()` and read by `loadUI()` at init. It is **display state
for this device only** and deliberately does not go through `state`/Firestore — otherwise
one device's open filter would follow the user to another.

### Row icons

🎁 (gift) and 🔗 (link) are `.icontoggle` buttons — grey and desaturated when off, full colour
when on — sitting on the item's title line beside the ✕, all four the same 26px box and the
same baseline. They are real `<button>`s, never a styled checkbox: a hidden checkbox reappears
as a bare control if the stylesheet arrives late or fails. `flagBtn()` builds any boolean one;
`linkBtn()` builds the link one. Do not put text labels on them and do not give them a
full-width `.btn` — that is what they replaced.

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

## MCP server

The connector runs **locally, over stdio**, launched by Claude Desktop from this Drive folder:

```
G:\My Drive\05_AI\Claude\Code\afula-move\mcp-server\afula_mcp.py
```

That is the only supported way to run it. Claude Desktop's config
(`%APPDATA%\Claude\claude_desktop_config.json`) looks like:

```json
{
  "mcpServers": {
    "afula-move": {
      "command": "python",
      "args": ["G:\\My Drive\\05_AI\\Claude\\Code\\afula-move\\mcp-server\\afula_mcp.py"],
      "env": { "PYTHONIOENCODING": "utf-8" }
    }
  }
}
```

`PYTHONIOENCODING=utf-8` for the same reason as the build script — the tools return Hebrew.
`AFULA_MOVE_UID` is optional: with one document under `moves/` the server picks it by itself.
The key is read from `mcp-server/service-account.json` next to the script unless `AFULA_SA_KEY`
overrides it.

### Remote hosting was tried and dropped

A hosted copy of this server ran on Render as the Claude connector **`afula-move-mcp`**. It did
not work, and **the user deleted that connector.** Do not recreate it, do not suggest Render,
Cloud Run, Fly, or any other host for this server, and do not point the user at a URL-based
connector. The local stdio connector in this Drive folder is the one they want.

The build files it needed — `render.yaml`, `mcp-server/Dockerfile`,
`mcp-server/.dockerignore` and `mcp-server/DEPLOY.md` — were deleted on 2 Sep 2026, locally
and in the GitHub repo. Do not recreate them.

What remains is inside `afula_mcp.py`: the `MCP_TRANSPORT=streamable-http` branch at the
bottom, and the `AFULA_MCP_TOKEN` / `AFULA_USE_ADC` / `K_SERVICE` handling in `_client()`.
Those are unused paths — leave them alone; `MCP_TRANSPORT` is unset locally, so stdio is
what runs.

Hosting it also meant putting the Firebase **service-account key** on a third-party machine.
That key stays on this disk, gitignored, and nowhere else — see *Sync* above.

---

## Build and deploy

```bash
cd "G:/My Drive/05_AI/Claude/Code/afula-move" && PYTHONIOENCODING=utf-8 python build_single.py
```

`PYTHONIOENCODING=utf-8` is required — the script prints Hebrew and Windows' default codepage
raises `UnicodeEncodeError` without it.

Then copy `index-single.html` to the clipboard and paste it over
https://github.com/ColorBull/afula-move/edit/main/index.html

**Driving that paste from a browser tool is the flaky part.** Sending Ctrl+A / Ctrl+V as
synthetic key events into the CodeMirror editor works sometimes and silently does nothing other
times — the editor keeps the old text and the **Commit changes… button simply stays disabled**,
which is the only signal you get. Always check it before opening the commit dialog:

```js
[].find.call(document.querySelectorAll('button'), x => /Commit changes/.test(x.textContent)).disabled
```

The reliable path is to paste from inside the page instead:

```js
var txt = await navigator.clipboard.readText();
var cm = document.querySelector('.cm-content');
cm.focus(); document.execCommand('selectAll');
var dt = new DataTransfer(); dt.setData('text/plain', txt);
cm.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true}));
```

`navigator.clipboard.readText()` returning `''` means the browser cannot see what PowerShell
put on the clipboard — re-run `Set-Clipboard` and read it again before blaming the editor.
Fetching the file straight from a local server instead is not an option: GitHub's CSP blocks
the request even with `Access-Control-Allow-Origin: *` on the server.

```bash
powershell -c "Get-Content -Raw -Encoding UTF8 index-single.html | Set-Clipboard"
```

Two things that trip this up every time:

1. **The local repo has no git remote.** Local commits are history-keeping only; they do not
   reach GitHub. Publishing happens exclusively through the web editor.

   **This means the GitHub repo can be ahead of this folder, and has been.** A Claude Code
   session working on a branch merged `dd/mm/yyyy` date fields (PR #1, Aug 2026) straight into
   GitHub; this folder never saw them, and the next paste of a locally-built `index-single.html`
   silently reverted the feature on the live site. **Before publishing, diff the deployed
   `index.html` against your build** — e.g. `curl -s https://colorbull.github.io/afula-move/ |
   grep -c '<some marker of a feature you did not write>'` — or read `src/` on GitHub and pull
   anything missing down first.
2. **`index.html` means two different things.** Locally it's the 50-line shell. In the GitHub
   repo it's the full inlined single-file build. Never paste the local `index.html` to GitHub,
   and never copy the GitHub one back down.

3. **The GitHub repo has three parts.** Root `index.html` is the deployed single-file
   build (~179KB); `src/` is a *backup copy* of the multi-file source (`app.js`, `calc.js`,
   `data.js`, `styles.css`, the 50-line `index.html` shell, `tests.html` / `tests.js`, the
   build scripts, this file); `mcp-server/` is a backup of the connector. `src/` is a
   snapshot, not the working tree - the working tree is still this Drive folder, and edits go
   there first. `src/` drifts until it is re-uploaded, so refresh it after meaningful changes.
   `service-account.json` must never appear in any of them.

`index-single.html` is gitignored — it is a build output, rebuilt on demand.

When driving the GitHub web editor: **wait for the commit dialog to actually open and confirm
it with a screenshot before typing the commit message.** Batching the click with the typing
once dumped the message into the code editor and corrupted the file.

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
- `calc.js` exists so the money math is testable at all. Add a case to `tests.js` for any change
  to it and open `tests.html`; the page prints `✔ הכול עבר · N/N`.
- Because everything else is inside an IIFE, testing internals means building a throwaway harness:
  fetch `app.js`, splice a `window.__t = { ... }` export in before the final `})();`, and eval
  it. That is how the calendar sync was tested against a stubbed `gcalFetch` without a real
  OAuth round trip. Delete the harness afterwards.
- **The Browser pane does not composite frames.** CSS transitions freeze mid-animation, so
  measurements taken while the drawer is "opening" are garbage and screenshots can time out.
  Inject `* { transition: none !important }` before measuring.
- **Width check for mobile.** Emulate 375px (and 320px), then walk every view and flag any
  control whose text does not fit: for a `<select>` measure the selected option with
  `canvas.measureText` in the element's own computed font and compare against
  `clientWidth - padding`; for anything else compare `scrollWidth` to `clientWidth`. Also assert
  `document.documentElement.scrollWidth === innerWidth` — a page that scrolls sideways on a
  phone is always a bug.
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

## Checking existing data before writing

When adding items via the `afula-move` MCP connector (e.g. from a call transcript or notes),
the local connector only exposes `add_item` — no `list_items` or `get_schema` to check what's
already there first. The `afula-move-mcp` (Render-hosted) connector did have read tools, but it
is gone — see *MCP server*, and do not go looking for it.

Worth checking once: `mcp-server/afula_mcp.py` in this folder *does* define eight tools —
`get_schema`, `get_overview`, `list_items`, `add_item`, `update_item`, `delete_item`, `search`,
`update_settings`. A connector that offers only `add_item` is running an older copy of the
script, so re-pointing Claude Desktop at the path above may be all it takes to get the read
tools back.

Before adding new items, open **https://colorbull.github.io/afula-move/** with Claude in
Chrome and look at the actual current list. This avoids duplicate entries and lets you match
the real field names/values in use (e.g. `SHOP_AREAS`, `SHOP_PRIO` from `data.js`) rather than
guessing.

## Known, accepted

- The live site logs a 404 for `sw.js`. The published artifact is one self-contained HTML file,
  so `sw.js` was never deployed beside it. The registration is `.catch()`-wrapped and nothing
  breaks. Offered to silence it; the user hasn't asked.
- Firestore sync can only be verified from an `https` origin with a real Google account, so it
  is not testable from `localhost` in the usual loop.
