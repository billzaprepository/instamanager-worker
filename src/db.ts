import { Pool } from 'pg'
import { config } from './config'

export const pool = new Pool(config.db)

export async function query(sql: string, params?: any[]) {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result.rows
  } finally {
    client.release()
  }
}

export async function queryOne(sql: string, params?: any[]) {
  const rows = await query(sql, params)
  return rows[0] || null
}

export async function execute(sql: string, params?: any[]) {
  const client = await pool.connect()
  try {
    await client.query(sql, params)
  } finally {
    client.release()
  }
}
