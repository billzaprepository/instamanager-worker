import { scheduleQueue, publishQueue } from './queues'
import { query } from './db'
import { refreshToken } from './instagram'
import { execute } from './db'

// Roda a cada minuto — verifica horários e enfileira jobs
export async function runScheduler() {
  const now           = new Date()
  const hour          = ((now.getUTCHours() - 3) % 24 + 24) % 24
  const todayStr      = now.toISOString().slice(0, 10)
  const brDate        = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  const todayWeekday  = brDate.getUTCDay()
  const todayMonthday = brDate.getUTCDate()

  // Enfileira job de schedule
  await scheduleQueue.add('check-schedules', {
    hour, todayStr, todayWeekday, todayMonthday,
  }, {
    jobId:              `schedule-${todayStr}-${hour}-${now.getMinutes()}`,
    removeOnComplete:   true,
  })

  // Busca posts aprovados ainda não enfileirados
  const approved = await query(`
    SELECT sp.id, sp.tenant_id, sp.ig_account_id
    FROM scheduled_posts sp
    WHERE sp.status = 'approved'
      AND (
        sp.publish_mode = 'immediate'
        OR (sp.publish_mode = 'scheduled' AND sp.scheduled_at <= now())
      )
    LIMIT 100
  `)

  for (const post of approved) {
    const jobId = `post-${post.id}`
    const existing = await publishQueue.getJob(jobId)
    if (existing) continue

    await publishQueue.add('publish-post', {
      postId:    post.id,
      tenantId:  post.tenant_id,
      accountId: post.ig_account_id,
    }, { jobId })
  }

  if (approved.length > 0) {
    console.log(`[scheduler] enqueued ${approved.length} approved posts`)
  }
}

// Renova tokens próximos de expirar (roda 1x/hora)
export async function refreshExpiringTokens() {
  const accounts = await query(`
    SELECT id, ig_username, long_lived_token
    FROM instagram_accounts
    WHERE is_active = true
      AND token_expires_at < now() + INTERVAL '15 days'
  `)

  for (const acc of accounts) {
    const data = await refreshToken(acc.long_lived_token)
    if (data?.access_token) {
      await execute(`
        UPDATE instagram_accounts
        SET long_lived_token = $1, access_token = $1,
            token_expires_at = now() + ($2 * INTERVAL '1 second'),
            last_token_refresh = now()
        WHERE id = $3
      `, [data.access_token, data.expires_in || 5183944, acc.id])
      console.log(`[scheduler] token renovado: @${acc.ig_username}`)
    }
  }
}
