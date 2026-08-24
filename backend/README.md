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
