import { Worker, Job } from 'bullmq'
import { redisConnection, publishQueue } from '../queues'
import { query, execute } from '../db'

export interface ScheduleJobData {
  hour:          number
  todayStr:      string
  todayWeekday:  number
  todayMonthday: number
}

async function processScheduleJob(job: Job<ScheduleJobData>) {
  const { hour, todayStr, todayWeekday, todayMonthday } = job.data

  console.log(`[schedule-worker] hour ${hour} weekday ${todayWeekday} monthday ${todayMonthday}`)

  const schedules = await query(`SELECT * FROM schedules WHERE is_active = true`)
  console.log(`[schedule-worker] found ${schedules.length} active schedules`)

  let created = 0

  for (const schedule of schedules) {
    try {
      // Verifica hora
      if (!schedule.hours?.includes(hour)) continue

      // Verifica dia da semana
      if (schedule.weekdays?.length > 0 && !schedule.weekdays.includes(todayWeekday)) continue

      // Verifica dia do mês
      if (schedule.monthdays?.length > 0 && !schedule.monthdays.includes(todayMonthday)) continue

      // Verifica se já executou hoje nessa hora (usa data de Brasília)
      const executions = await query(`
        SELECT id FROM schedule_executions
        WHERE schedule_id = $1
          AND hour = $2
          AND executed_at >= ($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
      `, [schedule.id, hour, todayStr + 'T00:00:00-03:00'])

      if (executions.length > 0) {
        console.log(`[schedule-worker] schedule "${schedule.name}" already executed at hour ${hour}`)
        continue
      }

      // Busca mídias
      const media = await query(`
        SELECT media_id FROM schedule_media
        WHERE schedule_id = $1 ORDER BY position ASC
      `, [schedule.id])

      if (!media.length) {
        console.log(`[schedule-worker] schedule "${schedule.name}" has no media`)
        continue
      }

      const idx     = (schedule.current_index || 0) % media.length
      const mediaId = media[idx].media_id

      // Cria posts para cada conta
      for (const accountId of (schedule.ig_account_ids || [])) {
        const rows = await query(`
          INSERT INTO scheduled_posts
            (media_id, ig_account_id, tenant_id, post_type, caption, hashtags,
             cover_url, story_link, publish_mode, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'immediate', 'approved')
          RETURNING id
        `, [
          mediaId, accountId, schedule.tenant_id,
          schedule.post_type, schedule.caption || '',
          schedule.hashtags || '', schedule.cover_url || null,
          schedule.story_link || null,
        ])

        const postId = rows[0]?.id
        if (postId) {
          await publishQueue.add('publish-post', {
            postId,
            tenantId:  schedule.tenant_id,
            accountId,
          }, { jobId: `post-${postId}` })
          created++
          console.log(`[schedule-worker] enqueued post ${postId} for @${accountId}`)
        }
      }

      // Registra execução
      await execute(`
        INSERT INTO schedule_executions (schedule_id, hour, status)
        VALUES ($1, $2, 'created')
      `, [schedule.id, hour])

      // Avança índice
      await execute(`
        UPDATE schedules SET current_index = $1 WHERE id = $2
      `, [(idx + 1) % media.length, schedule.id])

      console.log(`[schedule-worker] ✅ schedule "${schedule.name}" hour ${hour}: ${schedule.ig_account_ids?.length} posts enqueued`)

    } catch (err: any) {
      console.error(`[schedule-worker] error on schedule ${schedule.id}:`, err.message)
    }
  }

  console.log(`[schedule-worker] hour ${hour}: ${created} total jobs enqueued`)
  return { created }
}

export function startScheduleWorker() {
  const worker = new Worker<ScheduleJobData>('schedule', processScheduleJob, {
    connection:  redisConnection,
    concurrency: 1,
  })

  worker.on('completed', job => console.log(`[schedule-worker] ✅ job ${job.id} done`))
  worker.on('failed',    (job, err) => console.error(`[schedule-worker] ❌ job ${job?.id}:`, err.message))
  worker.on('error',     err => console.error('[schedule-worker] error:', err))

  console.log('[schedule-worker] started')
  return worker
}
