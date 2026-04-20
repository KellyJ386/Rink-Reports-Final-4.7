# Communications Module

Facility bulletin-board for announcements with audience targeting, read tracking, and optional acknowledgment.

---

## Data Model

### `announcements`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `facility_id` | `uuid` | Tenant key. Defaults to `current_facility_id()`. |
| `author_user_id` | `uuid` | FK to `users`. Immutable after insert. |
| `title` | `text` | Non-empty. |
| `body` | `text` | Markdown source. Non-empty. |
| `priority` | `text` | `normal` \| `important` \| `urgent`. Default `normal`. |
| `target_audience` | `text` | `all_staff` \| `specific_roles`. Default `all_staff`. |
| `target_role_ids` | `uuid[]` | Required (non-null, non-empty) when `target_audience = 'specific_roles'`. |
| `requires_acknowledgment` | `bool` | Whether recipients must actively ack. Default `false`. |
| `posted_at` | `timestamptz` | Set at insert. Immutable. |
| `expires_at` | `timestamptz` | Optional. Active list filters `expires_at < now()`. |
| `is_archived` | `bool` | Soft-delete flag. Default `false`. |
| `archived_by` | `uuid` | FK to `users`. Set when archived. |
| `archived_at` | `timestamptz` | Set when archived. |
| `idempotency_key` | `text` | Partial unique per `(facility_id, idempotency_key)` where not null. |
| `created_at` | `timestamptz` | Set at insert. Immutable. |

Constraint: `announcements_specific_roles_check` — `target_role_ids` must be non-null and non-empty when `target_audience = 'specific_roles'`.

### `announcement_reads`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `announcement_id` | `uuid` | FK to `announcements` (cascade). |
| `user_id` | `uuid` | FK to `users` (cascade). |
| `read_at` | `timestamptz` | Set at first open. Immutable after write. |
| `acknowledged_at` | `timestamptz` | Set when user clicks "I've read this". Null until acked. |

Unique constraint: `(announcement_id, user_id)`.

---

## Audience Targeting

When `target_audience = 'all_staff'`, all users in the facility are targets.

When `target_audience = 'specific_roles'`, `target_role_ids` holds a list of role UUIDs. A user sees the announcement if their `user_roles` entries overlap the array:

```sql
target_role_ids && (
  SELECT array_agg(role_id) FROM public.user_roles WHERE user_id = auth.uid()
)
```

This uses the PostgreSQL `&&` (array overlap) operator.

---

## RLS Policies

### `announcements`

**SELECT**: Facility match + one of:
- `has_module_access('communications', 'admin')`
- `author_user_id = auth.uid()`
- `has_module_access('communications', 'read')` AND audience targets the user

**INSERT**: `has_module_access('communications', 'write')`. `facility_id` defaults to `current_facility_id()` so facility forging is impossible.

**UPDATE**: `(author_user_id = auth.uid() OR has_module_access('communications', 'admin')) AND facility_id = current_facility_id()`. A trigger (`tg_announcements_immutable_cols`) additionally prevents changes to `id`, `facility_id`, `author_user_id`, `posted_at`, `created_at`.

**DELETE**: No policy — denied for all authenticated users.

### `announcement_reads`

**SELECT**: Own row (`user_id = auth.uid()`), platform admin, or user is author/admin of the parent announcement.

**INSERT**: `user_id = auth.uid()` — users stamp their own reads.

**UPDATE**: `user_id = auth.uid()`. A trigger (`tg_announcement_reads_immutable`) prevents changes to `user_id`, `announcement_id`, `read_at` — only `acknowledged_at` is mutable.

---

## Realtime

The `announcements` and `announcement_reads` tables have RLS enabled. Clients subscribe to postgres_changes filtered by `facility_id`:

```ts
supabase
  .channel('facility-announcements')
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'announcements', filter: `facility_id=eq.${facilityId}` },
    (payload) => { /* refresh list */ }
  )
  .subscribe()
```

Events correspond to: `INSERT` (posted), `UPDATE` (edited or archived), `UPDATE` on `announcement_reads` (read or acknowledged).

---

## Notification Hooks

### `announcement.posted`

Fired in `postAnnouncement()` via `publishNotificationMany`. Sent to every user in the target audience except the author.

Payload:
```json
{
  "announcement_id": "<uuid>",
  "title": "<string>",
  "priority": "normal | important | urgent",
  "author_name": "<string>"
}
```

Email: sent only when `priority === 'urgent'` (see `lib/notifications/email-catalog.ts`).

### `announcement.ack_reminder`

Not auto-sent by the module. Intended for a scheduled job that queries:

```sql
SELECT ar.user_id, a.id AS announcement_id, a.title
FROM announcement_reads ar
JOIN announcements a ON a.id = ar.announcement_id
WHERE a.requires_acknowledgment = true
  AND ar.acknowledged_at IS NULL
  AND ar.read_at < now() - interval '24 hours'
  AND a.is_archived = false
  AND (a.expires_at IS NULL OR a.expires_at > now());
```

Each matching row should trigger `publishNotification({ user_id, kind: 'announcement.ack_reminder', payload: { title, announcement_id } })`.

---

## Markdown Subset

Body is rendered via `react-markdown` + `rehype-sanitize`. Only the following elements are allowed:

`h2`, `h3`, `h4`, `p`, `strong`, `em`, `ul`, `ol`, `li`, `a`, `br`

Links (`a`) are restricted to `href` values with protocols `https`, `http`, `mailto`. `javascript:` and `data:` URIs are stripped.

The following are **not** allowed: `img`, `script`, `iframe`, `code`, `pre`, `table`, `div`, `span`, and raw HTML passthrough.

---

## Sort Algorithm

Active announcements are sorted client-side after fetch:

1. **Priority** (ascending): `urgent` → `important` → `normal`
2. **Unacked-required** (descending): unacked required announcements float above acked or non-required
3. **Unread** (descending): unread rows above read rows
4. **Newest first**: `posted_at` descending within each group

---

## Rejected Features

The following were explicitly out of scope and must not be added without a new agent brief:

- **Threaded replies / comments** — not a chat app; one-way broadcast only
- **Reactions / emoji** — no engagement signals
- **@mentions** — use `specific_roles` targeting instead
- **Direct messages** — not a messaging platform
- **Rich media (images, video, file attachments)** — markdown with `img` elements is blocked by sanitizer
- **Pinning** — priority is the pin signal; no separate pin state
- **Per-user push notifications (native/PWA)** — Realtime + email covers delivery; no push service
- **Drafts** — no saved draft state; post or discard
- **Scheduled posting** — no future `posted_at`; post immediately only
- **Edit history / changelog** — no edit log table; archive + repost is the workflow
- **Bulk archive** — archive is per-announcement
- **Admin `/admin/communications` page** — deferred to Phase 5 per ADMIN.md; Agent 6 owns that shell
# Communications module

Facility-scoped announcements with read/ack tracking, urgency-based email, and a
daily ack-reminder scheduled job. Agent 8.

## Scope

**In:**
- `announcements` + `announcement_reads` tables with full RLS
- Markdown bodies, limited subset (see _Rejected features_ below)
- Priority: `normal` / `important` / `urgent`
- Audience: `all_staff` or `specific_roles` (one-or-more role IDs)
- Optional `requires_acknowledgment` per post; per-recipient ack timestamps
- Expiry (explicit per post or facility default)
- Archive (soft-hide; never hard-delete)
- Read receipts admin view
- Notification fan-out: `publishNotification('announcement.posted', ...)`
- Email-eligible: `priority === 'urgent'` posts + all `announcement.ack_reminder`
- Scheduled daily ack-reminder job — first real scheduled job, establishes the
  `scheduled_job_runs` observability pattern for all later jobs

**Rejected features (explicit non-goals in v1):**
- Images / uploads / file attachments
- Tables, raw HTML, embedded media (iframes, video, audio), SVG/math
- `@mentions`, comments, reactions, custom emoji
- Pinning, scheduled future-post time
- Threading / replies
- Per-recipient delivery status beyond read/ack (no "delivered", no SMS)
- Editing announcement body after any user has marked it read (enforced by RLS)

If a user asks for one of these, the product answer is "post a follow-up
announcement."

## Data model

```
announcements
  id                        uuid pk
  facility_id               uuid → facilities(id)    [DEFAULT current_facility_id()]
  author_user_id            uuid → users(id)
  title                     text (1..200)
  body                      text (1..20000)
  priority                  normal | important | urgent
  target_audience           all_staff | specific_roles
  target_role_ids           uuid[]                   [required when specific_roles]
  requires_acknowledgment   bool
  posted_at                 timestamptz
  expires_at                timestamptz?
  is_archived               bool
  archived_by / archived_at
  idempotency_key           text?                    (partial unique with facility_id)
  created_at

announcement_reads
  id                        uuid pk
  announcement_id           uuid → announcements(id)
  user_id                   uuid → users(id)
  read_at                   timestamptz              [first-seen, preserved]
  acknowledged_at           timestamptz?
  UNIQUE(announcement_id, user_id)
```

Partial index `announcement_reads_pending_ack_idx` keyed on
`(acknowledged_at, read_at) WHERE acknowledged_at IS NULL` keeps the ack-reminder
subquery fast as the facility's volume grows.

## RLS

**SELECT (announcements):**
```
is_platform_admin()
OR (facility_id = current_facility_id() AND (
      has_module_access('communications','admin')
      OR author_user_id = auth.uid()
      OR (has_module_access('communications','read')
          AND audience_match)
    ))
```
where `audience_match` is:
```
target_audience = 'all_staff'
OR target_role_ids && <caller's role_ids array>
```

**INSERT (announcements):** `facility_id` via DEFAULT; WITH CHECK requires
`has_module_access('communications','admin')`. Author-stamped from `auth.uid()`.

**UPDATE (announcements):** allowed only while `NOT EXISTS (SELECT 1 FROM
announcement_reads WHERE announcement_id = announcements.id)` — prevents
silent-edit-after-read. Archive happens via `rpc_archive_announcement`, which
flips `is_archived` as a SECURITY DEFINER with its own guard (author-of-own OR
admin-of-communications).

**DELETE:** not permitted at any level. Soft-delete only.

**announcement_reads:**
- SELECT: own rows + admins see rows in own facility (cross-row via JOIN)
- INSERT: own rows only (`user_id = auth.uid()`)
- UPDATE: only acknowledged_at, only own rows
- DELETE: forbidden

## Sort order — the feed

`announcements_for_current_user()` SQL function joins announcement + own
announcement_reads row + author name and stamps a `sort_bucket`:

| bucket | meaning                                    |
|--------|--------------------------------------------|
| 1      | `priority='urgent'` and unread              |
| 2      | `requires_acknowledgment` and unacked       |
| 3      | Other unread                                |
| 4      | Read, non-archived, non-expired             |
| 5      | Archived OR expired                         |

Feed queries `ORDER BY sort_bucket ASC, posted_at DESC`. The bucket logic lives
in SQL so the feed page, the global nav-badge count, and any future dashboard
card share the same definition of "unread".

## Links

All links in announcement bodies render with:
```html
<a target="_blank" rel="noopener noreferrer" href="...">
```

Enforced by a React component override in `MarkdownRenderer`, not by the
sanitize schema. Schema-level attribute rewriting in rehype-sanitize is fragile;
the component override is obvious and testable. Protocol policy: `http`,
`https`, `mailto` only.

## Markdown pipeline — defense in depth

```
user input string
  ↓
react-markdown { skipHtml: true }       ← blocks raw HTML at parse
  ↓
rehype-sanitize { ANNOUNCEMENT_SCHEMA } ← filters the HAST
  ↓
component overrides { a: … }            ← forces target + rel
  ↓
rendered DOM
```

`ANNOUNCEMENT_SCHEMA` allowlist:
`p, br, hr, h2, h3, h4, strong, em, u, del, ul, ol, li, a, blockquote, code`.
No img, video, iframe, table, form, script, style, svg.

## Posting — flow

`postAnnouncement(input)`:
1. Validate title/body length + audience shape
2. Resolve `expires_at` (explicit > facility default `communications.default_expiry_days` > null)
3. INSERT via authenticated client (`facility_id` DEFAULTs; WITH CHECK enforces admin)
4. Service-role query: DISTINCT recipient user_ids (all_staff ⇒ active users,
   specific_roles ⇒ user_roles JOIN). Self-excluded.
5. Serial `publishNotification({ kind: 'announcement.posted' })` fan-out.
   `publishNotification` handles email gating via `EMAIL_CATALOG`.
6. Audit write via service role.

> **TODO(agent-7-fan-out):** serial loop is fine at v1 scale (tens of
> recipients per post). If facilities grow to hundreds, move to a QStash-queued
> fan-out job with per-recipient retry.

## Ack-reminder — the first real scheduled job

`POST /api/jobs/ack-reminder`, QStash-signed, scheduled daily.

Wraps its body in `logScheduledJobRun('ack-reminder', async (ctx) => {…})`
which opens a `scheduled_job_runs` row with counters + duration + error.
`ctx.bumpProcessed/Succeeded/Failed` track per-recipient progress; metadata
captures the candidate count. On throw, the row still updates with
`error_if_any` so `/platform-admin/health` sees the partial work.

Candidate resolution lives in `public.ack_reminder_candidates(window_start,
overdue_cutoff, limit)` SECURITY DEFINER. Audience predicate mirrors the post
fan-out (all_staff ⇒ active users, specific_roles ⇒ user_roles JOIN). Dedup via
`NOT EXISTS` on notifications with `kind='announcement.ack_reminder'` and
`(payload->>'announcement_id')::uuid = a.id` in the last 24h.

Safety rails:
- `ORDER BY posted_at ASC` — oldest reminders first
- `LIMIT 1000` per invocation — bounded runs, backlog resumes next tick
- Partial expression index `notifications_ack_reminder_announcement_idx`
  keeps the NOT EXISTS lookup constant-time

## Scheduled-job pattern (retrofitted to Agent 7)

Every `/api/jobs/*` route now wraps its body in `logScheduledJobRun`. The six
Agent 7 jobs (`trial-expiration-check`, `trial-ending-notification`,
`past-due-notification`, `stripe-webhook-retry`, `availability-cutoff-reminder`,
`ack-reminder`) conform. A row per run:

```
scheduled_job_runs (
  id              uuid
  job_slug        text        -- immutable post-insert (trigger)
  started_at      timestamptz -- immutable post-insert
  ended_at        timestamptz
  duration_ms     integer
  rows_processed  integer
  rows_succeeded  integer
  rows_failed     integer
  error_if_any    text
  metadata        jsonb
)
```

Partial index `scheduled_job_runs_errors_idx WHERE error_if_any IS NOT NULL`
lets `/platform-admin/health` surface failures without a full-table scan.

Why now, not after Agent 5 and 9: retrofitting one pattern across six existing
routes is a 20-minute diff; retrofitting it after ten more jobs have shipped
with hand-rolled logging is a multi-hour refactor with behavior risk.

## Files

```
supabase/migrations/
  20260425000001_announcements.sql            ← tables + RLS
  20260425000002_announcements_fns.sql        ← rpc_archive + feed fn
  20260425000003_scheduled_job_runs.sql       ← obs table + notifications index
  20260425000004_ack_reminder_fn.sql          ← ack_reminder_candidates RPC

lib/communications/
  types.ts        ← exports Announcement, AnnouncementFeedRow, etc.
  sanitize.ts     ← ANNOUNCEMENT_SCHEMA for rehype-sanitize
  post.ts         ← postAnnouncement() server-only
  read.ts         ← markAnnouncementRead, acknowledgeAnnouncement
  archive.ts      ← archiveAnnouncement (RPC wrapper)
  feed.ts         ← fetchAnnouncementFeed, fetchAnnouncementById, badge count
  receipts.ts     ← fetchAnnouncementReceipts (admin view)

components/communications/MarkdownRenderer.tsx

lib/scheduled-jobs/
  run-logger.ts   ← logScheduledJobRun() — retrofitted to all Agent 7 routes
  verify-qstash.ts (pre-existing)

app/modules/communications/
  page.tsx              ← feed
  list-client.tsx
  admin-check.ts        ← hasCommunicationsAdminAccess()
  actions.ts            ← post / ack / archive server actions (subscription-gated)
  new/page.tsx + new-client.tsx
  [id]/page.tsx + detail-client.tsx
  [id]/receipts/page.tsx
  archive/page.tsx

app/api/jobs/ack-reminder/route.ts  ← real implementation now

supabase/tests/18_communications.test.sql
```

## Agent 6 contract

The sidebar badge for Communications reads the same definition of "unread" as
the feed — call `fetchAnnouncementBadgeCount()` from `lib/communications/feed.ts`.
If Agent 6 wants a per-module admin screen, it consumes `fetchAnnouncementReceipts(id)`
plus `archiveAnnouncement(id)`; no new DB functions needed.

## Known gaps / later work

- Realtime re-sort on new post. Today a new announcement requires a manual
  refresh; adding a Realtime subscription to the facility's `announcements`
  channel is low-lift but not v1.
- Per-facility quiet hours for email (e.g. skip email 10pm–6am local). Shape is
  a `communications.email_quiet_hours` setting read inside
  `publishNotification`. Not v1.
- Markdown preview side-by-side. Current UI toggles between Edit and Preview;
  a split-pane is a nice-to-have.
