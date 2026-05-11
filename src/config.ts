import dotenv from 'dotenv'
dotenv.config()

export const config = {
  redis: {
    url: process.env.REDIS_URL || 'redis://default:Bs428690@postgrest_redis:6379',
  },
  db: {
    host:     process.env.DB_HOST     || 'epanel2.billzap.com.br',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'postgrest',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || 'Bs428690',
  },
  instagram: {
    apiBase: 'https://graph.instagram.com/v25.0',
  },
  worker: {
    concurrency:    parseInt(process.env.WORKER_CONCURRENCY    || '10'),
    maxRetries:     parseInt(process.env.WORKER_MAX_RETRIES    || '3'),
    retryDelay:     parseInt(process.env.WORKER_RETRY_DELAY    || '60000'), // 1 min
    containerPollInterval: parseInt(process.env.CONTAINER_POLL_INTERVAL || '15000'), // 15s
    containerTimeout:      parseInt(process.env.CONTAINER_TIMEOUT       || '1200000'), // 20min
  },
  cron: {
    secret: process.env.CRON_SECRET || 'sfagfgds1g5sd1g5sdg1',
  },
}
