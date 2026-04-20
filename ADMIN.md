# ADMIN.md

The Admin Control Center. Shipped by Agent 6. Every `/admin/*` route lives here; Agent 6 wraps each page in the admin layout + access gate.

Read `FOUNDATION.md` and `ONBOARDING.md` first. Specific integrations:
- Invites → calls `createInvite` / `revokeInvite` / `resendInvite` from `lib/invites/`
- Module enable → calls `enableModule` from `lib/facility/enable-module.ts`
- Form schema publish → calls `saveFormSchemaDraft` / `publishFormSchema` / `discardFormSchemaDraft` from `lib/forms/publish.ts`
- Ice Depth template management → deep-links to `/modules/ice-depth/templates/*` (owned by Agent 4; Admin shows a summary)
- Force-logout → `lib/auth/force-logout.ts` (inline implementation now; Agent 7 replaces by rewriting the file)
- Stripe Portal → disabled button with tooltip; Agent 7 wires later

---

## Sitemap — Phase 3

```
/admin/                              Dashboard (subscription banner, setup checklist, counters, recent activity)
/admin/users                         Users table; change role, deactivate/reactivate
/admin/invites                       Outstanding + history; send, revoke, resend
/admin/roles                         Roles list; create, delete
/admin/roles/[id]                    Role detail + module-access matrix
/admin/modules                       Per-facility module toggle (admin_control_center protected)
/admin/resources                     Tabs per resource_type; soft-delete only via is_active toggle
/admin/forms                         List of form_schemas
/admin/forms/[module]/[form_type]    Form schema editor (desktop-only, @dnd-kit reorder)
/admin/forms/[module]/[form_type]/history            Version list
/admin/forms/[module]/[form_type]/history/[version]  Read-only JSON + Copy JSON
/admin/option-lists                  Option lists list; create, delete (scans published schemas only)
/admin/option-lists/[id]             Items editor; key immutable per DB trigger
/admin/ice-depth                     Summary card + deep-links to module's own template editor
/admin/billing                       Subscription status card + disabled "Manage billing" until Agent 7
/admin/audit                         Paginated (50/page, max 500 pages), action + date filters
```

Deferred to Phase 5 (after Agents 5 and 8 land):
- `/admin/communications`
- `/admin/scheduling`

## Soft-delete is the model

**Default pattern for user-editable entities: toggle `is_active` (or equivalent) rather than `DELETE`.**

Rationale:
- Historical submissions reference these rows by id. Deleting breaks detail-view rendering.
- Auditable trails depend on the rows existing.
- Undo is trivial (flip the flag back).

Applied throughout the product:

| Entity                         | Delete allowed?                                  | Retirement mechanism               |
| ------------------------------ | ------------------------------------------------ | ---------------------------------- |
| `users`                        | Platform-admin only (SQL)                        | `active = false` (forceLogoutUser) |
| `facility_resources`           | **No** (v1) — server action returns friendly error | `is_active = false`              |
| `option_list_items`            | Yes, but discouraged                              | `is_active = false`                |
| `option_lists`                 | Yes, iff no **published** schema references it   | —                                  |
| `roles`                        | Yes, iff no users are assigned; system roles no  | —                                  |
| `form_schemas`                 | Platform-admin only                               | Disable the parent module          |
| `facility_modules`             | Platform-admin only                               | `is_enabled = false`               |
| `announcements` (Agent 8)      | Never                                             | `is_archived = true`               |
| `audit_log`, `form_schema_history`, `ice_depth_template_history` | Never (trigger-blocked) | — |

Future modules should follow this pattern. If you need to truly purge, it's a platform-admin SQL operation, not a facility-admin UI action.

## Facility settings catalog

Every key ever written to `facilities.settings` must be declared in `lib/facility/settings.ts::SETTINGS_SCHEMA`. Agent 6 surfaces UI writes for keys it owns; Agent 7 and Agent 8 wire their own keys when they land.

| Key                                      | Type    | Default              | Owner       | Surfaced in admin UI (phase) |
| ---------------------------------------- | ------- | -------------------- | ----------- | ---------------------------- |
| `communications.require_ack_enabled`     | bool    | `true`               | Agent 8     | Phase 5                      |
| `communications.default_expiry_days`     | int     | `30`                 | Agent 8     | Phase 5                      |
| `scheduling.availability_cutoff_days`    | int     | `14`                 | Agent 5     | Phase 5                      |
| `scheduling.swap_approval_mode`          | enum    | `'manager_approval'` | Agent 5     | Phase 5                      |
| `notifications.email_enabled`            | bool    | `true`               | Agent 7     | Agent 7                      |
| `analytics_enabled`                      | bool    | `true`               | Agent 7     | Agent 7                      |

`setSetting(key, value)` is the only supported write path. Unknown keys are rejected.

## force-logout contract

See `lib/auth/force-logout.ts` — file-level docstring lists the acceptance criteria Agent 7 must satisfy when it replaces the inline implementation. Summary:

1. Invalidates all active sessions (global signOut, refresh tokens revoked)
2. Callable from server actions
3. Writes audit_log with action = `user.force_logout`
4. Sets `users.active = false` in the same logical operation
5. Returns `{ ok: true } | { ok: false; error }`
6. No distributed session registry in v1
7. Caller enforces AuthZ (we already require admin access to reach this action)

## How Agent 6 uses other agents' server actions

| Agent 6 UI                                | Server action it calls                                |
| ----------------------------------------- | ----------------------------------------------------- |
| `/admin/invites` (send new)               | `createInvite` (lib/invites/create.ts)                |
| `/admin/invites` (revoke)                 | `revokeInvite` (lib/invites/revoke.ts)                |
| `/admin/invites` (resend)                 | `resendInvite` (lib/invites/resend.ts, Agent 6 ships) |
| `/admin/modules` (toggle on)              | `enableModule` (lib/facility/enable-module.ts)        |
| `/admin/forms/.../(save)`                 | `saveFormSchemaDraft` (lib/forms/publish.ts)          |
| `/admin/forms/.../(publish)`              | `publishFormSchema` (lib/forms/publish.ts)            |
| `/admin/forms/.../(discard)`              | `discardFormSchemaDraft` (lib/forms/publish.ts)       |
| `/admin/users` (deactivate / force logout)| `forceLogoutUser` (lib/auth/force-logout.ts)          |
| `/admin/billing` (Manage)                 | Disabled — Agent 7's Stripe Portal action             |

## Adding a new admin-config page for a future module

Recipe (step-by-step so future agents can follow blind):

1. Check the Phase 5 `/admin/<module>/` entries in the sitemap; if your module isn't listed, discuss with the user before adding a new section to the admin nav.
2. Create `app/admin/<module>/page.tsx` (Server Component). Import nothing that requires facility admin access — the layout's `requireAdminControlCenterAdmin()` already gates you.
3. Read-only display: pull data via the user's `createClient()`; RLS handles isolation.
4. Writes: call your module's existing server actions. Never duplicate business logic in the admin layer — the admin page is a thin UI on top.
5. Settings writes: use `setSetting(key, value)` from `lib/facility/settings.ts`. Add your keys to the catalog at the top of that file first.
6. Audit: every mutation server action already writes `audit_log` (via its own implementation); don't double-log.
7. Add a nav link in `app/admin/layout.tsx` under the appropriate section.
8. Update this `ADMIN.md` sitemap + settings catalog.

## Known gaps / deferred

- **Form schema editor preview pane**: v1 editor shows the schema tree but not a live `<DynamicForm />` preview. Admins can click "View history" → "Copy JSON" to paste into a new draft, which covers rollback. Live preview is a v2 polish item.
- **Drag-drop section reorder**: v1 uses up/down arrows for sections; @dnd-kit sortable list for fields within a section.
- **Section move for fields**: editing which section a field belongs to requires remove-and-re-add in v1. v2 can add a "Move to section" dropdown.
- **Audit log full-text search**: not v1 — offset pagination + action/date filters cover the common case.
- **Bulk user import**: v2.
- **Force-logout**: v1 is inline in `lib/auth/force-logout.ts`. Agent 7 replaces.
- **Stripe Portal deep-link**: disabled button + tooltip until Agent 7.

## Files shipped

**Server actions (lib/admin/)**
- `require-admin.ts` — access gate used by the admin layout
- `people.ts` — users + roles + access matrix
- `configuration.ts` — modules + resources (delete explicitly forbidden)
- `option-lists.ts` — lists + items; published-only dependency scan on delete

**Shared**
- `lib/auth/force-logout.ts` — contract + inline implementation
- `lib/facility/settings.ts` — catalog + typed reader/writer
- `lib/invites/resend.ts` — new; Agent 6 needed it

**Admin shell**
- `app/admin/layout.tsx` — left-rail nav + access gate

**Pages** — every route in the sitemap above

**Docs**
- `ADMIN.md` (this file)
