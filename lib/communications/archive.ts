import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logger } from '@/lib/observability/logger'

export type ArchiveAnnouncementResult =
  | { ok: true; already_archived: boolean }
  | { ok: false; error: string }

/**
 * Archive (soft-hide) an announcement. Calls the rpc_archive_announcement
 * SECURITY DEFINER function which enforces: author-of-own OR
 * admin-of-communications-in-same-facility. Idempotent — if already archived,
 * returns ok with already_archived: true.
 *
 * Archive vs delete: announcements are never hard-deleted. Sort bucket 5
 * (archived/expired) keeps them visible under a "Show archived" toggle, which
 * matches the documented soft-delete-as-product-pattern in ADMIN.md.
 */
export async function archiveAnnouncement(
  announcementId: string,
): Promise<ArchiveAnnouncementResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const { data, error } = await supabase.rpc('rpc_archive_announcement', {
    p_announcement_id: announcementId,
  })
  if (error) {
    logger.error('announcements.archive.failed', { error: error.message, announcementId })
    return { ok: false, error: error.message }
  }

  // rpc_archive_announcement returns a boolean: true = newly archived, false = was already archived
  const newlyArchived = Boolean(data)

  if (newlyArchived) {
    // Audit only when we actually flipped state
    const svc = createServiceClient()
    void svc
      .from('audit_log')
      .insert({
        actor_user_id: user.id,
        action: 'announcement.archived',
        entity_type: 'announcement',
        entity_id: announcementId,
      })
      .then(({ error: e }) => {
        if (e) console.error('archiveAnnouncement: audit write failed', e)
      })
  }

  return { ok: true, already_archived: !newlyArchived }
}
