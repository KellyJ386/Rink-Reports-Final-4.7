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
