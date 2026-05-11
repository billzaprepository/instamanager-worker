import { Queue, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'
import { config } from './config'

export const redisConnection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
})

// Filas principais
export const publishQueue = new Queue('publish', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts:    config.worker.maxRetries,
    backoff: {
      type:  'exponential',
      delay: config.worker.retryDelay,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail:     { count: 500 },
  },
})

export const scheduleQueue = new Queue('schedule', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 100 },
  },
})

export const tokenRefreshQueue = new Queue('token-refresh', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: { count: 50 },
  },
})

export const publishQueueEvents = new QueueEvents('publish', {
  connection: new IORedis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }),
})

console.log('[queues] Redis connected:', config.redis.url.replace(/:[^:@]+@/, ':****@'))
