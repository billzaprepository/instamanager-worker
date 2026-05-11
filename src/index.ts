import { startPublishWorker }  from './workers/publish.worker'
import { startScheduleWorker } from './workers/schedule.worker'
import { runScheduler, refreshExpiringTokens } from './scheduler'
import { startApiServer } from './api'
import { pool } from './db'
import { redisConnection } from './queues'

async function main() {
  console.log('🚀 InstaManager Worker starting...')

  // Testa conexão com banco
  try {
    await pool.query('SELECT 1')
    console.log('[db] ✅ PostgreSQL connected')
  } catch (err) {
    console.error('[db] ❌ PostgreSQL connection failed:', err)
    process.exit(1)
  }

  // Testa conexão com Redis
  try {
    await redisConnection.ping()
    console.log('[redis] ✅ Redis connected')
  } catch (err) {
    console.error('[redis] ❌ Redis connection failed:', err)
    process.exit(1)
  }

  // Inicia workers
  const publishWorker  = startPublishWorker()
  const scheduleWorker = startScheduleWorker()

  // Inicia API de health/metrics
  startApiServer(3001)

  // Scheduler — roda a cada 60 segundos
  console.log('[scheduler] starting — interval: 60s')
  await runScheduler() // executa imediatamente
  setInterval(runScheduler, 60 * 1000)

  // Renovação de tokens — roda a cada hora
  setInterval(refreshExpiringTokens, 60 * 60 * 1000)
  setTimeout(refreshExpiringTokens, 5000) // roda 5s após iniciar

  // Graceful shutdown
  async function shutdown() {
    console.log('\n[worker] shutting down gracefully...')
    await publishWorker.close()
    await scheduleWorker.close()
    await pool.end()
    await redisConnection.quit()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT',  shutdown)

  console.log('✅ InstaManager Worker running!')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
