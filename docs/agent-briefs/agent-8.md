# Agent 8 — Communications Module

## Your role
You build the Communications module. It is deliberately the smallest of the custom modules. It has a long history of scope creep and you are going to resist it. This is not a chat app. This is not a messaging platform. It is a **read-mostly bulletin board with acknowledgment tracking**.

## What you can assume exists
- Agent 1a's foundation (`FOUNDATION.md`), including `role_module_access`
- Agent 6's `/admin/communications` page — you define the shape; Agent 6 builds the UI
- Agent 7's `notifications` table — you publish events; Agent 7 delivers
- Agent 7's `ack-reminder` scheduled job — you provide the query
- `facilities.settings` JSONB — you read `settings.communications.*`

**Read `FOUNDATION.md`, `ADMIN.md`, `PLATFORM.md` before starting.** If Agent 7 hasn't shipped notifications yet, stub publishes; Agent 7 wires on landing.

## Product context
Rink managers post announcements: "Zamboni #2 down, use #1." "Crew meeting at 3pm." Today: paper on the whiteboard. This module digitizes that — targeting, priority, acknowledgment tracking.

## Stack
Same as everyone else. Plus:
- `react-markdown` + `rehype-sanitize`
- Supabase Realtime
- **No third-party chat SDK.**

## Decisions made

- **Audience: `all_staff | specific_roles`** with `target_role_ids uuid[]` when specific.
- **Markdown subset, text-only.** Allowed: headings h2–h4, bold, italic, lists, links (sanitized href). No images, tables, code blocks, HTML passthrough.
- **Post-now only.** No scheduled posts, no drafts.
- **Edit locked after first read.** Correction = archive + repost.
- **Archive, don't delete.**
- **Expiry auto-hide is query-computed**, not cron.
- **Posting permission = write access on Communications module.** No parallel admin config.
- **Admin settings in `facilities.settings.communications`:**
  - `require_ack_enabled` (bool, default true)
  - `default_expiry_days` (int, default 30)
- **Realtime channel: `facility:{facility_id}:announcements`.**

## Deliverables

### 1. Schema

#### `announcements`
- `id`, `facility_id` (default `current_facility_id()`)
- `author_user_id`, `title`, `body` (markdown text)
- `priority` — `'normal' | 'important' | 'urgent'`
- `target_audience` — `'all_staff' | 'specific_roles'`
- `target_role_ids` uuid[] (required when specific_roles)
- `requires_acknowledgment` bool default false
- `posted_at` timestamptz default now()
- `expires_at` timestamptz nullable
- `is_archived` bool default false, `archived_by`, `archived_at`
- `idempotency_key` text + partial unique
- `created_at`

Index on `(facility_id, posted_at desc)` and on `(facility_id) where is_archived = false`.

Check: `target_audience = 'specific_roles' → target_role_ids is not null and length > 0`.

#### `announcement_reads`
- `id`, `announcement_id` (fk cascade), `user_id` (fk users)
- `read_at` default now()
- `acknowledged_at` nullable
- Unique on `(announcement_id, user_id)`

### 2. RLS

#### announcements SELECT
```sql
(is_platform_admin() OR facility_id = current_facility_id()) AND (
  has_module_access('communications', 'admin')
  OR author_user_id = auth.uid()
  OR (
    has_module_access('communications', 'read') AND
    (
      target_audience = 'all_staff'
      OR target_role_ids && (
        SELECT array_agg(role_id) FROM user_roles WHERE user_id = auth.uid()
      )
    )
  )
)
```

#### announcements INSERT
- `has_module_access('communications', 'write')`
- `facility_id` forced via DEFAULT

#### announcements UPDATE
- Author only, if no reads exist (content edits)
- Admins can toggle `is_archived` only
- `facility_id`, `author_user_id` never updatable

#### announcements DELETE — not permitted

#### announcement_reads
- SELECT: own rows, OR author/admin sees all for their announcements
- INSERT/UPDATE: write-own only (`user_id = auth.uid()`)

### 3. Staff view — `/modules/communications/`
- Default: unarchived + non-expired
- Sort: urgent pinned to top; within priority, unread first then newest
- Unacknowledged-required pinned until acked
- Priority indicators: normal (plain), important (yellow stripe), urgent (red stripe + bold)
- Tap → detail, writes `announcement_reads` row on first open
- Archive view at `/modules/communications/archive`

### 4. Detail view — `/modules/communications/[id]`
- Title, priority, author, posted_at
- Rendered markdown (react-markdown + rehype-sanitize)
- If `requires_acknowledgment`: "I've read this" button → `acknowledged_at`
- Author/admin: "View receipts" link

### 5. Compose — `/modules/communications/new`
Requires `has_module_access('communications', 'write')`.
- Title, body (textarea + live preview)
- Priority, audience (radio + role multiselect if specific)
- Requires acknowledgment toggle (disabled if `require_ack_enabled = false`)
- Optional expiry (defaults from `default_expiry_days`)
- Post → server action

### 6. Edit — `/modules/communications/[id]/edit`
- Reachable by author if no reads exist
- If reads exist: shows "Archive + repost" buttons

### 7. Receipts — `/modules/communications/[id]/receipts`
- Author + admin only
- Summary + drill-in list

### 8. Server actions
- `postAnnouncement({ ..., idempotency_key })`
  - Verify write, insert, publish `announcement.posted` to each target user, audit_log, Realtime emit
- `editAnnouncement({ id, ... })` — blocks if reads exist
- `archiveAnnouncement({ id })`
- `markRead({ announcement_id })` — upsert, Realtime emit
- `acknowledge({ announcement_id })`

### 9. Notifications (via Agent 7)
Events:
- `announcement.posted` — recipients: target audience. Email-eligible for `urgent` only.
- `announcement.ack_reminder` — Agent 7's job runs this query:
  ```sql
  SELECT a.id, ar.user_id
  FROM announcements a
  JOIN announcement_reads ar ON ar.announcement_id = a.id
  WHERE a.requires_acknowledgment
    AND a.is_archived = false
    AND ar.acknowledged_at IS NULL
    AND ar.read_at < now() - interval '24 hours'
  ```

### 10. Realtime
- Channel: `facility:{facility_id}:announcements`
- Events: `posted`, `edited`, `archived`, `read`, `acknowledged`
- Clients filter by target-audience match — don't trust Realtime for authz (RLS is still the gate).

### 11. Admin surface (Agent 6 builds)
`/admin/communications`:
- Toggle `require_ack_enabled`
- Number input `default_expiry_days`
- Read-only "posting roles" summary

### 12. Documentation
`COMMUNICATIONS.md`:
- Data model + audience logic
- RLS policy explanation
- Realtime catalog
- Notification hooks
- Markdown subset (what's allowed; `rehype-sanitize` config)
- **Rejected-features list**

## Definition of done — hard gate
- Manager posts `all_staff` announcement → every staff user gets notification + sees it live within ~2s.
- Role-targeted: only matching users see it.
- Read receipts accurate.
- Ack flow works; required-ack pinned until acked.
- Urgent dominates regardless of age.
- Expiry auto-hides from default list; archive view still shows.
- Edit blocked after first read; UI offers archive + repost.
- Markdown safely renders: `<img src=x onerror=...>`, `<script>`, `<iframe>`, `[link](javascript:...)` all stripped.
- No image URLs render (stripped to text).
- Urgent announcement fires email.
- Ack reminder query returns expected rows.
- RLS: cross-facility isolation; role-mismatched in same facility blocked.
- Idempotency: duplicate post with same key → one insert.
- `COMMUNICATIONS.md` with rejected-features list.

## Rejected features (v1)
- Direct messages, group chats, threads
- Replies, reactions, comments
- File attachments
- Image embeds in markdown
- SMS delivery
- Email-to-post
- Scheduled posts
- Drafts
- Post-editing after first read
- Read/unread per-role analytics dashboards beyond per-post receipts
- Reader-side annotation
- Manual pinning beyond auto urgent/unacked
- Expiry reminders ("archives in 2 days")

## What you do NOT build
- Admin config UI — Agent 6
- Notifications table or delivery — Agent 7
- `ack-reminder` scheduled job — Agent 7 (you provide the query)
- Email templates beyond Agent 7 defaults
- Rejected-list features

## Constraints
- Browser-only, code inline.
- Do not modify Agent 1a, 2, 6, 7 code. Extend only.
- Supabase Realtime only; no third-party chat SDK.
- Markdown must pass `rehype-sanitize`; no HTML passthrough.
- Do not add a table beyond the two specified.
- Posting permission = `role_module_access`; no parallel model.

## First response
Do NOT write code. Deliver:
1. Confirm you've read `FOUNDATION.md`, `ADMIN.md`, `PLATFORM.md`.
2. Two-table DDL in prose + check constraint.
3. Audience-targeting RLS SQL sketch.
4. Realtime channel + event catalog with payload shapes.
5. `rehype-sanitize` allowed-elements config.
6. Rejected-features list verbatim.
7. Open questions.

Wait for approval before writing code.
