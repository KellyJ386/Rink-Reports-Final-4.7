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
