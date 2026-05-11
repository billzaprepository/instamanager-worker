import { config } from './config'

const BASE = config.instagram.apiBase

function uniqueUrl(url: string): string {
  return `${url}?t=${Date.now()}`
}

export async function createContainer(post: any, token: string): Promise<string> {
  const body: Record<string, string> = { access_token: token }

  if (post.post_type === 'reel') {
    body.media_type = 'REELS'
    body.video_url  = uniqueUrl(post.media_url)
    body.caption    = `${post.caption || ''}\n\n${post.hashtags || ''}`.trim()
    if (post.cover_url) body.cover_url = post.cover_url
  } else if (post.post_type === 'story') {
    body.media_type = 'STORIES'
    if (post.media_type === 'video') { body.video_url = uniqueUrl(post.media_url) }
    else { body.image_url = uniqueUrl(post.media_url) }
    if (post.story_link) body.link = post.story_link
  } else if (post.post_type === 'post_image') {
    body.image_url = uniqueUrl(post.media_url)
    body.caption   = `${post.caption || ''}\n\n${post.hashtags || ''}`.trim()
  } else if (post.post_type === 'post_video') {
    body.media_type = 'REELS'
    body.video_url  = uniqueUrl(post.media_url)
    body.caption    = `${post.caption || ''}\n\n${post.hashtags || ''}`.trim()
  }

  const res  = await fetch(`${BASE}/me/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const data = await res.json() as any

  if (!data.id) {
    throw new Error(data.error?.message || `Falha ao criar container: ${JSON.stringify(data)}`)
  }
  return data.id
}

export async function checkContainerStatus(containerId: string, token: string): Promise<string> {
  const res  = await fetch(`${BASE}/${containerId}?fields=status_code&access_token=${token}`)
  const data = await res.json() as any
  return data.status_code || 'IN_PROGRESS'
}

export async function publishContainer(containerId: string, token: string): Promise<{ id: string; permalink?: string }> {
  const res  = await fetch(`${BASE}/me/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ creation_id: containerId, access_token: token }),
  })
  const data = await res.json() as any

  if (!data.id) {
    throw new Error(data.error?.message || `Falha ao publicar: ${JSON.stringify(data)}`)
  }

  const mediaRes = await fetch(`${BASE}/${data.id}?fields=permalink&access_token=${token}`)
  const mediaData = await mediaRes.json() as any

  return { id: data.id, permalink: mediaData.permalink }
}

export async function refreshToken(longLivedToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  try {
    const res  = await fetch(`${BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${longLivedToken}`)
    const data = await res.json() as any
    if (data.access_token) return data
    return null
  } catch {
    return null
  }
}

export async function waitForContainer(
  containerId: string,
  token: string,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<void> {
  const start = Date.now()

  while (true) {
    const status = await checkContainerStatus(containerId, token)

    if (status === 'FINISHED') return
    if (status === 'ERROR') throw new Error('Instagram rejeitou o container.')

    if (Date.now() - start > timeoutMs) {
      throw new Error('Timeout: Instagram não processou em 20 minutos.')
    }

    await new Promise(r => setTimeout(r, pollIntervalMs))
  }
}
