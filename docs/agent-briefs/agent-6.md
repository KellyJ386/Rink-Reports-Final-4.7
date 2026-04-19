# Agent 6 — Admin Control Center

## Your role
You build the facility admin shell — every `/admin/*` route in the product. You are the most integrative agent: almost every prior agent has deferred admin UI to you. You own the shell, the cross-cutting admin screens, and the per-module config pages for Communications and Scheduling. You do not own platform-admin (that's Agent 7).

Module agents define the server actions; you call them. You do not reimplement business logic.

## What you can assume exists
- Agent 1a's foundation (`FOUNDATION.md`) + seeded `modules`, `roles`, `role_module_access`, `facility_modules`, `facilities.settings`
- Agent 1b: invite server actions, bootstrap, `facility_resources`, `module_default_schemas`, `facility_subscriptions`, `enableModule`
- Agent 2: `form_schemas`, `form_schema_history`, `option_lists`, `option_list_items`, `FORM_SCHEMA_FORMAT.md`, `FORM_ENGINE.md`, meta-schema validator, `<DynamicForm />` (you use it for preview)
- Agent 3: seven modules live, permission matrix rows exist
- Agent 4: `/modules/ice-depth/templates/*` — Ice Depth's admin surface lives there; your admin shell just links to it
- Agent 5: Scheduling server actions; no admin UI (you build it)
- Agent 7: `facility_subscriptions` extended with Stripe wiring + billing portal integration; you surface status and deep-link to Stripe portal; `forceLogoutUser` server action
- Agent 8: Communications server actions; no admin UI (you build it)

**Read every prior `.md` before starting.** You touch all of their seams.

## Product context
Facility admins need one place to configure the product for their rink: users, roles, modules, forms, dropdowns, surfaces, cutoff windows, announcement permissions. This is the product's main customization surface and the lever that keeps 2,500 facilities on one codebase.

If the admin UI is bad, the sales pitch falls apart.

## Stack
Same as everyone else. Plus:
- `@dnd-kit` for drag-drop (form schema editor field reorder)
- No third-party admin framework
- Use `<DynamicForm />` from Agent 2 for the form schema preview pane

## Decisions made

- **Route prefix: `/admin/*`.** All admin routes live here.
- **Access gate: `has_module_access('admin_control_center', 'admin')`.** Enforced in middleware.
- **Platform admins reach `/admin/*`** for any facility via impersonation (session cookie set by Agent 7's platform-admin shell).
- **Module agents do not build their own admin pages.** You build `/admin/communications`, `/admin/scheduling`, etc.
- **Form schema editor is desktop-only.**
- **Other admin pages responsive-enough** at 390px but not optimized.
- **Audit log viewer paginated, filterable**, not full-text searchable in v1.
- **No bulk user import.**
- **No custom role templates or cloning.**
- **"Last edited by X on Y"** on every admin-editable entity.
- **Form schema editor built from scratch** — narrower format than what libraries support.

## Deliverables

### 1. Admin shell
- `/admin/` — dashboard: module access, pending invites count, pending time-off count, unacknowledged-communications count, subscription status banner
- Left-rail navigation: **People**, **Configuration**, **Modules**, **Account**
- Breadcrumbs
- Consistent page layout
- Mobile: left rail collapses to hamburger

### 2. People

#### `/admin/users`
- Table: name, email, role(s), active, last login, last edited
- Filter by role, active status
- Actions: change role, deactivate, reactivate, force logout (calls Agent 7's `forceLogoutUser`)
- Deactivating logs user out immediately and blocks re-login

#### `/admin/invites`
- Table: email, role, invited by, sent, expires, status
- Primary action: "Invite user" → modal
- Actions: revoke, resend, copy invite link

#### `/admin/roles`
- List roles with `is_system` indicator
- Create / edit / delete (only if no users assigned; Admin role non-deletable)

#### `/admin/roles/[id]`
- Module access matrix: rows = modules, columns = access levels
- Assigned users list
- Save flips `role_module_access` + writes audit_log

### 3. Configuration

#### `/admin/modules`
- List modules from catalog
- Toggle enabled/disabled for facility
- On enable: calls `enableModule` which seeds `form_schemas` from defaults
- On disable: warn, confirm, audit_log

#### `/admin/resources`
Manage `facility_resources`.
- Tabs per `resource_type` ("Ice Surfaces," "Compressors," "Zambonis," "Air Quality Devices," "Shift Positions")
- List, add, edit, deactivate

#### `/admin/forms`
List of form schemas for this facility — one row per `(module_slug, form_type)`.

#### `/admin/forms/[module]/[form-type]` — form schema editor
Desktop-only. Two-column layout.

**Left column: field list + editor**
- Drag-reorder (@dnd-kit)
- Add field: type picker
- Field config: key, label, help_text, required, type-specific options
- For select/multiselect/radio: inline OR pick option_list OR pick resource_type
- Conditional visibility editor
- Section grouping

**Right column: live preview**
- Renders `<DynamicForm />` against the current draft
- Updates on every edit

**Action bar:**
- Save draft
- Publish (runs meta-schema validator)
- Discard draft
- View history

Core fields shown with lock icon, not editable.

#### `/admin/option-lists`
- List; create, edit, delete (blocked if referenced)

#### `/admin/option-lists/[id]`
- Items editor: add, edit label, reorder, deactivate
- Stable `key` auto-generated on first save, then locked

### 4. Modules

#### `/admin/communications`
- Toggle: `require_ack_enabled` → `facilities.settings.communications.require_ack_enabled`
- Default expiry days → `facilities.settings.communications.default_expiry_days`
- Read-only summary of posting roles; link to `/admin/roles/[id]`

#### `/admin/scheduling`
- Week start: read-only "Sunday"
- Availability cutoff days → `facilities.settings.scheduling.availability_cutoff_days`
- Swap approval mode: radio → `facilities.settings.scheduling.swap_approval_mode`
- Bulk copy note: read-only summary + link to docs

#### `/admin/ice-depth`
- Summary card; link to `/modules/ice-depth/templates`

### 5. Account

#### `/admin/billing`
- Subscription status from `facility_subscriptions`
- Plan + price
- Trial days remaining
- "Manage billing" → Stripe Portal (Agent 7's server action)
- Past-due banner

#### `/admin/audit`
- Paginated audit log, facility-scoped
- Filters: actor, action type, date range

### 6. Server actions
Thin admin-side wrappers calling module actions:
- User role change, deactivation, reactivation, force-logout
- Invite send, revoke, resend
- Role create, update, delete, access matrix
- Module enable, disable
- Facility resource CRUD
- Form schema save draft, publish, discard, restore from history (via Agent 2)
- Option list + items CRUD
- Facility setting updates (enumerated keys only; no generic "save arbitrary JSON")

All actions:
- Verify `has_module_access('admin_control_center', 'admin')`
- Write to `audit_log`
- Never accept `facility_id` from client
- Idempotency keys where retry-sensitive

### 7. Documentation
`ADMIN.md` covering:
- Admin shell architecture
- How to add a new admin-config page for a future module
- **Facility settings catalog** — every key used across modules, with type, default, owning module
- Server action pattern
- Known v2 features deferred

## Definition of done — hard gate
- Every `/admin/*` route live, gated by admin access on Admin Control Center
- Platform admin impersonating can use every admin function
- Invite flow end-to-end: admin sends → recipient accepts → appears in `/admin/users`
- Role edit flow updates sidebar access on next page load
- Module disable flow makes routes 404
- Form schema editor: add field → save draft → preview → publish → meta-schema validates → version bumps → history row written
- Option list: rename label preserves history key-wise
- Facility resources: add/deactivate flows
- Communications admin: ack toggle + default expiry behavior changes
- Scheduling admin: swap approval mode flip changes the flow
- Billing: trial, past-due, Stripe portal all work
- Audit log viewer: all admin actions here write rows; filter works
- All admin server actions reject client-supplied `facility_id`
- RLS: platform admin impersonation works; other facility's admin can't see this one
- Form editor at 1280px+; other admin pages at 390px
- `ADMIN.md` exists with facility settings catalog

## What you do NOT build
- Platform admin shell (`/platform-admin/*`) — Agent 7
- Ice Depth template editor — Agent 4
- Any module business logic
- Bulk user import — v2
- Custom role templates — v2
- SSO/SAML — v2
- White-label branding — v2
- API keys / webhooks for facilities — v2
- Tables shipped by prior agents
- A generic "save any JSON to settings" server action

## Constraints
- Browser-only workflow, code inline.
- Do not modify Agent 1a, 1b, 2, 3, 4, 5, 7, 8 code. Extend only. Call their server actions.
- Do not invent permission models.
- Do not add tables.
- All admin actions write to `audit_log`.

## First response
Do NOT write code. Deliver:
1. Confirm you've read every prior `.md`.
2. Full sitemap of `/admin/*` routes with one-line purpose.
3. Wireframe-in-words of `/admin/forms/[module]/[form-type]` at 1440px.
4. Wireframe-in-words of `/admin/users` at 390px and 1280px.
5. Facility settings catalog: every key, type, default, owning module.
6. Server action list grouped by section.
7. Open questions for prior agents' work.
8. Build order (suggested: People → Configuration → Forms editor → Option Lists → Modules → Billing → Audit).

Wait for approval before writing code.
