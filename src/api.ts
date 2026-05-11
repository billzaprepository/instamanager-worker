import http from 'http'
import { publishQueue, scheduleQueue } from './queues'
import { query } from './db'

// API HTTP simples para health check e métricas
export function startApiServer(port = 3001) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')

    if (req.url === '/health') {
      res.writeHead(200)
      res.end(JSON.stringify({ ok: true, timestamp: new Date().toISOString() }))
      return
    }

    if (req.url === '/metrics') {
      try {
        const [publishCounts, scheduleCounts] = await Promise.all([
          publishQueue.getJobCounts(),
          scheduleQueue.getJobCounts(),
        ])

        const dbStats = await query(`
          SELECT
            COUNT(*) FILTER (WHERE status = 'approved')   AS approved,
            COUNT(*) FILTER (WHERE status = 'publishing') AS publishing,
            COUNT(*) FILTER (WHERE status = 'published')  AS published,
            COUNT(*) FILTER (WHERE status = 'failed')     AS failed
          FROM scheduled_posts
          WHERE created_at > now() - INTERVAL '24 hours'
        `)

        res.writeHead(200)
        res.end(JSON.stringify({
          queues: { publish: publishCounts, schedule: scheduleCounts },
          posts_24h: dbStats[0],
          timestamp: new Date().toISOString(),
        }))
      } catch (err: any) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    if (req.url === '/failed' && req.method === 'GET') {
      try {
        const failed = await publishQueue.getFailed(0, 20)
        res.writeHead(200)
        res.end(JSON.stringify(failed.map(j => ({
          id:        j.id,
          postId:    j.data.postId,
          failedReason: j.failedReason,
          attemptsMade: j.attemptsMade,
        }))))
      } catch (err: any) {
        res.writeHead(500)
        res.end(JSON.stringify({ error: err.message }))
      }
      return
    }

    res.writeHead(404)
    res.end(JSON.stringify({ error: 'Not found' }))
  })

  server.listen(port, () => {
    console.log(`[api] Worker API running on port ${port}`)
  })

  return server
}
