# robokyle API server

Node/Express + MongoDB backend for accounts and community design uploads.
The static site (GitHub Pages) stays where it is; the React frontend will call this API.

## Setup

```bash
cd server
cp .env.example .env      # set JWT_SECRET to something long and random
npm install
npm run dev               # or: npm start
```

Requires a local `mongod` (defaults to `mongodb://127.0.0.1:27017/robokyle`).
Uploaded files live in `server/uploads/` (git-ignored).

## Auth

Send `Authorization: Bearer <token>` on protected routes. Tokens last 7 days.

| Method | Path                 | Body                                   | Notes |
|--------|----------------------|----------------------------------------|-------|
| POST   | `/api/auth/register` | `{ username, email, password }`        | returns `{ token, user, verification }`; sends the confirmation email |
| POST   | `/api/auth/login`    | `{ username \| email, password }`      | returns `{ token, user }` |
| POST   | `/api/auth/google`   | `{ credential }`                       | the ID token from Google Identity Services; returns `{ token, user }` |
| POST   | `/api/auth/verify`   | `{ token }`                            | the token from the emailed link; returns a fresh `{ token, user }` |
| POST   | `/api/auth/resend`   | none                                   | auth required; one per minute |
| GET    | `/api/auth/me`       | none                                   | auth required |

### Email verification

Local sign-ups start unverified. They can browse and download, but posting a work,
editing one, commenting and upvoting all return `403 EMAIL_UNVERIFIED` until the
address is confirmed. Only a SHA-256 hash of the link token is stored, and it is
good for 24 hours and single use.

Verification is enforced whenever SMTP is configured, so the site is never left in
a state where an account cannot be confirmed. Force it either way with
`REQUIRE_EMAIL_VERIFICATION=true|false`. With SMTP unset, the link is logged to the
server console and (outside production) returned in the register/resend response,
so local sign-up still works end to end.

### Google sign-in

Set `GOOGLE_CLIENT_ID` to an OAuth 2.0 **Web application** client ID. The React app
renders Google's button only when that is present, and `/api/auth/google` returns
503 without it. Signing in with Google links to an existing account with the same
address rather than creating a second one, and those accounts count as verified
because Google already confirmed the address. They have no password, so a password
login against one answers "This account uses Google sign-in".

## Config

`GET /api/config` (public) returns the upload rules the React app needs before it can
render the right form: `{ uploadsAdminOnly, maxUploadMb, maxFiles, allowedExtensions }`.

## Designs

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET    | `/api/designs?q=&tag=&sort=new\|top\|downloads&page=&limit=` | optional | paginated list with counts and a `thumbUrl` for the first image |
| POST   | `/api/designs` | required | multipart, see fields below |
| GET    | `/api/designs/:id` | optional | full design incl. files, links, guide, comments, history |
| PUT    | `/api/designs/:id` | author/admin | same fields plus `editNote`, `removeFiles`, `fileMeta`. Snapshots the previous state into `history` and bumps `version` **only when something actually changed** |
| DELETE | `/api/designs/:id` | author/admin | removes design and its files |
| GET    | `/api/designs/:id/files/:fileId` | none | downloads the file, increments `downloadCount` |
| GET    | `/api/designs/:id/files/:fileId/view` | none | inline preview for the gallery; raster images only, does **not** count as a download |
| POST   | `/api/designs/:id/upvote` | required | toggles the caller's upvote |
| POST   | `/api/designs/:id/comments` | required | `{ body }` |
| DELETE | `/api/designs/:id/comments/:commentId` | comment author / design author / admin | |

### Multipart fields on POST / PUT

| Field | Shape | Notes |
|-------|-------|-------|
| `title`, `description` | text | required on create |
| `tags` | comma list | max 20 |
| `files[]` | files | admin-only while `UPLOADS_ADMIN_ONLY=true` |
| `captions` | JSON array of strings | aligned with the order `files[]` were appended |
| `fileMeta` | JSON `[{ id, caption, order }]` | edits captions/ordering of files already stored (PUT) |
| `removeFiles` | comma list of file ids | detaches from the current version; the bytes stay so old versions still resolve |
| `links` | JSON `[{ label, url, kind, note }]` | `kind`: `files` \| `video` \| `docs` \| `parts` \| `other`. Replaces the whole list. http/https only, max 25 |
| `guide` | JSON `{ summary, printSettings, materials[], tools[], steps[{ title, body, imageFile }] }` | `imageFile` is the id of one of the design's own image files. Max 60 steps |
| `editNote` | text | optional one-liner on top of the auto-generated changelog |

### Versioning

Every edit that changes anything appends a `history` entry holding the **previous**
state plus `changes`: an auto-generated list like `Added 2 files: base.stl, photo.png`,
`Links removed: Build video`, `2 guide steps edited`. A no-op PUT returns 200 and does
not create a version. Files referenced by an old version stay downloadable.

### Files

Uploads are grouped by extension into `image` / `model` / `doc` / `archive` / `other`,
which is what drives the gallery and the grouped file lists on the design page.

Allowed upload types: stl, obj, 3mf, step/stp, scad, f3d, gcode, zip, pdf, txt, md, csv, png, jpg, gif, webp, svg.
Max size per file is `MAX_UPLOAD_MB` (default 50), up to 20 files per design; nginx caps
the whole request body (see `deploy/nginx-api.robokyle.org.conf`).

Uploads are admin-only while `UPLOADS_ADMIN_ONLY=true` (the default). Everyone else
attaches external links instead, which render alongside hosted files on the design page.
Set `UPLOADS_ADMIN_ONLY=false` to open uploads to every signed-in member.

## Members

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET    | `/api/users/:username` | optional | public profile: bio, stats, their works, their recent comments |
| PATCH  | `/api/users/me` | required | `{ bio }`, capped at 600 characters |
| POST   | `/api/users/:username/role` | admin | `{ role: "admin" \| "user" }` |

The profile response carries `isSelf` and `canManageRole` so the page knows whether
to show the bio editor and the promote/demote buttons. An admin cannot change their
own role, which stops them locking themselves out; another admin or the CLI script
below does it instead.

`stats` counts works, comments, upvotes received, downloads across their works,
files shared and build guides written. The works array uses the same card shape as
the works list (see `lib/cards.js`), so both stay in sync.

## Lineage

A revision is a work in its own right: its author owns it, edits it and versions
it like any other. Three fields tie the family together:

| Field | Meaning |
|-------|---------|
| `parent` | the work this was built on, `null` for an original |
| `parentVersion` | which version of the parent was taken |
| `root` | the original the whole family descends from; an original is its own root |
| `depth` | 0 for an original, +1 per generation |

Because every work in a family shares a `root`, the entire tree is one indexed
query no matter how deep it goes.

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/designs/:id/fork` | verified | copies the work (files, links, guide) to the caller and records the link |
| GET | `/api/designs/:id/lineage` | none | every work in the family, flat; the client builds the tree |

Forking copies no bytes. Files are content-addressed (see below), so the
revision names the same blobs as its parent and only stores what it changes.
Deleting a work leaves its revisions standing; they report `parentMissing` and
hang from the top of the tree rather than disappearing with it.

## Skills & XP

Every account has nine visible skill categories (Mechanical, Fabrication,
Electronics, Software, Systems, Ability, Documentation, Design, Community) plus
hidden, derived-only Innovation. All constants live in `config/xp.js`.

**XP is computed, never stored as truth.** There is no ledger: XP is a pure
function of the works, votes and references already in the database
(`lib/xp.js`), cached on the user document and recomputed on every action that
touches it plus a nightly full pass. Un-voting, deleting a work or dropping a
reference removes its XP by construction, because the source is gone. The one
thing frozen at action time is the voter's weight — weights derive from levels
and levels from XP, so a live lookup would be circular.

**Declarations.** Every work declares 1-4 categories with weights summing to
100 — the only input XP routing reads. Works that reference other works gain
Systems weight automatically (composition is the Systems skill). Need tags are
separate, discovery-only, and never touch XP.

**Earning (implemented):** publish 100 (forks and >70%-file-overlap
near-duplicates publish at 25 with a provenance link), version release 25,
votes +/-10 x voter weight, being referenced 50 innovation + 25 split.
Caps: 5 publishes/day, 3 versions/work/day plus 5 versions/account/day (F7),
500 lifetime vote XP from any one voter to any one author, net vote XP floored
at -publish, self-votes and self-references worth 0.

**Longevity rules (audit v0.2):** a work's upvote XP damps by volume — full
value for votes 1-50, x0.5 to 200, x0.25 to 1000, x0.1 beyond — so a level
costs about the same in any era; the vote COUNT still displays in full (F3).
A reference pays its E7 only once the referencing work is alive (net weighted
votes >= 5) — junk works referencing real ones emit nothing, and because XP is
a recompute, "fires late but fires once" needs no machinery (F4). Negative
category XP floors to level 0 while the ledger shows the true sum (F8).
Category ids are immutable forever; display names may change (F12).

**The F1 trade-off, decided:** the audit's rule-versioning (store every
amount immutably so tuning never re-prices history) presumes an event ledger.
This implementation recomputes from domain data instead — simpler, and chosen
deliberately: tuning a constant re-prices all history uniformly on the next
recompute. Fair (every era re-prices together), but not frozen. If earned
history must ever become immutable, that is the moment to introduce the
event ledger.

**Vote weight** = clamp(0.2 + 0.1 x level(category) + 0.05 x totalLevel,
0.2, 5.0), computed in the work's dominant category and frozen on the vote.
New accounts vote at 0.2.

**Levels:** cumulative XP = 75 x L^2, capped at 99 per category. Total level =
sum of the nine visible levels. **RoboXP** = work XP + 0.6 x social XP (social
sources land with the forum), shown site-wide; `/creators` ranks everyone by
it, filterable per category. Dormant rules (verified builds, doc revisions,
standards compliance, forum answers, moderation) keep their constants in the
config for when those features land.

`npm run xp:recompute` rebuilds every account's totals from scratch.


### Downvote accountability

A downvote is a claim, and claims are accountable. Downvoting a work requires a
written reason (10+ chars); the reason becomes an anonymous card in the comment
stream (identity stored, never shown), and the community judges it with plain
up/down votes — terminal by construction: the judge route accepts a direction
and nothing else, so the chain is one level deep.

States are derived from the judgment votes, never stored: net weighted score
>= +15 with 3+ voters = **endorsed** (critic earns 15 comm, capped 3/day; the
work's penalty never increases); <= -15 with 5+ voters = **struck** (the
downvote's XP restores automatically on recompute, and the downvoter loses 2x
the voided amount). States freeze 30 days after the card is posted. A struck
card survives retraction — the sting is not dodgeable by withdrawing after
losing. Work authors cannot judge cards on their own works; critics cannot
judge their own cards. More than 3 strikes in a week logs the account as a
moderation case. Critic-side ledger entries are unnamed, so the public
receipts never unmask an anonymous downvote.

Constants live in `config/xp.js` under `accountability`. Comment/forum
downvotes (display-only per the spec) wait on those features existing.

### The visual doctrine (§7.1)

The interface reports; it never begs. No confetti, no streaks, no timers, no
progress bars outside the profile, nothing purchasable or manually granted —
the visuals only ever render what the recompute proves. A level-up is one small
self-dismissing toast. The profile is the OSRS register: avatar ring (mastery
colours at 99, grey for new users), a flat 3x3 skill grid whose tooltips quote
the category scope straight from `config/xp.js`, the Innovation aura as a tier
name with no number, and a public XP ledger where every total decomposes into
receipts. Inline presence is one chip: primary title + level, or "new user".
Category colours are defined once in the config and are the only saturation on
the page.

## Creating works: the wizard

Creating a work is a three-stage wizard, not a form. Everything autosaves to a
draft (`work_drafts` via `/api/drafts`) — close the tab mid-step, nothing is
lost; nothing is public and no XP fires until Stage 3's publish.

1. **What is it?** — name, description, need tags, overview images.
2. **How is it made?** — repeatable step blocks: title, body, duration hint,
   and per-step attachments (the jig photo lives on the step that uses the
   jig). A step can also BE another work — a reference-step embeds it, pinned
   to a version (default) or following latest. The Eating Kit is literally
   reference-steps plus glue-steps.
3. **Ship it** — preview, category declaration (last, deliberately, with a
   starting split suggested from step content), soft checklist, publish.

The steps ARE the build guide: the work page renders them in order with their
media, so the minimum-effort path already ships real documentation. The work's
file list is the union of overview + step attachments, assembled at read time.
The Built-from list and the composite `sys` bonus derive from the
reference-steps (`syncUses`); E7 fires per distinct referenced work on publish.

Editing reopens the same wizard prefilled (one draft per author+work, resumed
not duplicated); publishing an edit makes a new version and **requires a
one-line changelog**. Reference-steps pinned to a version show when the part
has moved on.

Drafts hold their files: the blob sweep counts draft attachments as
references, and drafts idle past `DRAFT_EXPIRY_DAYS` (180) are deleted, after
which the sweep frees anything only they held.

## Body mounts, requirements, software facets (delta)

**Body mounts.** Body sites are standards in the ports system, namespaced
`body:*`. `npm run seed:body` ships the curated 25 sites (the spec says 24 but
its own list has 25) under a `robokyle` system account, idempotently, with the
shared field kits (limb, residual, frame). A device that mounts to the body
accepts the site and states `laterality` (left, right, either) plus its fit
values against the site's fields; anatomy hubs then answer "what mounts here
and fits me". Anatomy naming extends only through the standard-proposal path.

**Requirements.** A work may declare `requires`: equipment (owned; 10 broad
common items, including experience entries like software-experience) and
materials (consumed; 8 broad kinds, fixed 8 units). Deliberately coarse: the
stuff, not the SKU; sizes and grades go in the note field. Steps can cite the
equipment they need. A composite's effective BOM is its own plus every
reference-stepped work's, walked deep, equipment deduped with provenance and
material quantities summed per unit. Members list owned equipment on their
profile (private; only the derived flag ever shows); works answer buildable or
missing-these, and `?buildable=1` filters the list to what the viewer can make
(own requirements only; the composite-deep answer lives on the work page).
No XP anywhere in this layer.

**Software facets.** `facets` on works, fixed list (server, database,
firmware, driver, api, mobile, desktop, library); zero XP, filterable with
`?facet=`. The nine categories stay frozen.

All vocabularies live in `config/xp.js`.

## Modular works

A work can be built out of other works: an eating kit made from a spoon, a
socket and a connector. Each part is recorded as

```json
{ "work": "<id>", "version": null, "label": "the spoon", "note": "" }
```

`version: null` follows that work wherever it goes, so fixing the spoon fixes
every kit that uses it. A number pins it, for a build that only works against
the version it was tested with; the page then shows when a newer version exists.

Guide steps can point at one of the parts, so "now fit the connector" links
straight to it.

The parts list is versioned like everything else: the history records what a
work was built from at each version, and the changelog names parts coming, going
and being re-pinned.

Refusals: a work cannot use itself, a part must exist, and a set of works cannot
end up using each other in a loop at any depth (`Design.wouldCycle`). Legitimate
nesting is fine, so a socket may use a connector while a kit uses the socket.

Reverse links come free: a work's page lists what it is `usedIn`, which is what
makes improving a shared part visibly worth doing.

## File storage

Files are stored once under the SHA-256 of their contents, at
`uploads/ab/abcdef…`, and rows record that hash. So:

* forking a work copies no bytes at all, only the metadata rows
* a revision that changes one file stores only that file
* the same file uploaded twice, by anyone, occupies one blob
* an old version keeps its files alive, because history counts as a reference

Nothing is unlinked until the last reference is gone: not another work, not a
revision that inherited it, not an older version of anything. Deleting your work
removes your page; everyone else's stays, and so do the files they point at.

Uploads land in `uploads/tmp/` first and move into the store once accepted.

Deleting a work removes rows and unlinks nothing. Reclaiming happens in a sweep
every few hours, and only for blobs untouched for at least an hour. That grace
period is the point: checking "is this referenced?" and unlinking are two steps,
and between them a fork or an upload of the same bytes could take a fresh
reference on a blob about to be removed. Sweeping later closes the window, at
the cost of space being freed within hours rather than instantly.

The sweep also clears abandoned uploads from `tmp/` and reports rows that point
at a file missing from the store.

```bash
npm run gc            # list stored files nothing references
npm run gc -- --delete
```

`BLOB_SWEEP_HOURS` and `BLOB_GRACE_MINUTES` tune it.

## Making someone an admin

From the `backend/` directory:

```bash
npm run users              # list every account and its role
npm run admin -- kyle      # make kyle an admin
npm run admin -- kyle user # take it back
```

Or call the script directly, which avoids npm's `--` separator:

```bash
node scripts/role.js kyle
node scripts/role.js kyle@example.com admin
node scripts/role.js --list
```

Takes a username or an email. It reads `MONGO_URI` from `.env`, so it talks to the
same database the server does, and it exits non-zero if the account does not exist.

Errors are always `{ "error": "message" }` with an appropriate status code.
