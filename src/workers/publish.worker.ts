import { Worker, Job } from 'bullmq'
import { redisConnection } from '../queues'
import { query, execute } from '../db'
import { createContainer, waitForContainer, publishContainer } from '../instagram'
import { config } from '../config'

export interface PublishJobData {
  postId:    string
  tenantId:  string
  accountId: string
}

async function processPublishJob(job: Job<PublishJobData>) {
  const { postId, tenantId } = job.data

  console.log(`[publish-worker] job ${job.id} — post ${postId}`)

  const rows = await query(`
    SELECT
      sp.id, sp.post_type, sp.caption, sp.hashtags,
      sp.cover_url, sp.story_link, sp.publish_attempts,
      mf.public_url AS media_url, mf.media_type,
      ia.ig_username, ia.long_lived_token, ia.access_token
    FROM scheduled_posts sp
    JOIN media_files mf ON mf.id = sp.media_id
    JOIN instagram_accounts ia ON ia.id = sp.ig_account_id
    WHERE sp.id = $1 AND sp.tenant_id = $2
  `, [postId, tenantId])

  const post = rows[0]
  if (!post) throw new Error(`Post ${postId} não encontrado`)

  const token = post.long_lived_token || post.access_token
  if (!token) throw new Error(`Token não encontrado para @${post.ig_username}`)

  await execute(`
    UPDATE scheduled_posts
    SET status = 'publishing', container_status = 'processing',
        publish_attempts = $1, last_attempt_at = now()
    WHERE id = $2
  `, [(post.publish_attempts || 0) + 1, postId])

  await job.updateProgress(10)

  console.log(`[publish-worker] creating container @${post.ig_username} — ${post.post_type}`)
  const containerId = await createContainer(post, token)

  await execute(`
    UPDATE scheduled_posts SET ig_container_id = $1, used_token = $2 WHERE id = $3
  `, [containerId, token, postId])

  await job.updateProgress(30)
  console.log(`[publish-worker] container ${containerId} — waiting FINISHED...`)

  await waitForContainer(
    containerId, token,
    config.worker.containerTimeout,
    config.worker.containerPollInterval
  )

  await job.updateProgress(80)

  const { id: igMediaId, permalink } = await publishContainer(containerId, token)

  await execute(`
    UPDATE scheduled_posts
    SET status = 'published', container_status = 'finished',
        ig_media_id = $1, ig_permalink = $2, published_at = now()
    WHERE id = $3
  `, [igMediaId, permalink || null, postId])

  await job.updateProgress(100)
  console.log(`[publish-worker] ✅ published ${postId} @${post.ig_username} → ${permalink}`)

  return { igMediaId, permalink }
}

export function startPublishWorker() {
  const worker = new Worker<PublishJobData>('publish', processPublishJob, {
    connection:  redisConnection,
    concurrency: config.worker.concurrency,
  })

  worker.on('completed', job => console.log(`[publish-worker] ✅ job ${job.id} done`))

  worker.on('failed', async (job, err) => {
    console.error(`[publish-worker] ❌ job ${job?.id} failed:`, err.message)
    if (job?.data?.postId) {
      await execute(`
        UPDATE scheduled_posts SET status = 'failed', error_message = $1 WHERE id = $2
      `, [err.message, job.data.postId]).catch(console.error)
    }
  })

  worker.on('error', err => console.error('[publish-worker] error:', err))

  console.log(`[publish-worker] started — concurrency: ${config.worker.concurrency}`)
  return worker
}
