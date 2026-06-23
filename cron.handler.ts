import { Env } from './auth.middleware'
import { newId } from './id'
import { generateDailyReport } from './daily-report.handler'

const GRAPH = 'https://graph.facebook.com/v21.0'

async function graphGet(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH}${path}`)
  url.searchParams.set('access_token', token)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const r = await fetch(url.toString())
  return r.json() as Promise<Record<string, unknown>>
}

async function getPageToken(pageId: string, userToken: string): Promise<string> {
  const data = await graphGet(`/${pageId}`, userToken, { fields: 'access_token' }) as { access_token?: string }
  return data.access_token ?? userToken
}

async function getAvgEngagement(igId: string, token: string, followers: number) {
  const r = await graphGet(`/${igId}/media`, token, {
    fields: 'like_count,comments_count',
    limit: '12',
  }) as { data?: Array<{ like_count?: number; comments_count?: number }> }
  const posts = r.data ?? []
  if (!posts.length) return { avgLikes: 0, avgComments: 0, engagement: 0 }
  const avgLikes    = posts.reduce((s, p) => s + (p.like_count ?? 0), 0) / posts.length
  const avgComments = posts.reduce((s, p) => s + (p.comments_count ?? 0), 0) / posts.length
  const engagement  = followers > 0 ? Math.round(((avgLikes + avgComments) / followers) * 10000) / 100 : 0
  return { avgLikes: Math.round(avgLikes * 10) / 10, avgComments: Math.round(avgComments * 10) / 10, engagement }
}

export async function updateInstagramAccounts(env: Env) {
  if (!env.FB_USER_TOKEN) return

  const pages = await graphGet('/me/accounts', env.FB_USER_TOKEN, {
    fields: 'id,name,instagram_business_account',
    limit: '50',
  }) as { data?: Array<{ id: string; name: string; instagram_business_account?: { id: string } }> }

  const pagesData = pages.data ?? []
  let updated = 0

  for (const page of pagesData) {
    const ig = page.instagram_business_account
    if (!ig) continue

    try {
      const pageToken = await getPageToken(page.id, env.FB_USER_TOKEN)

      const profile = await graphGet(`/${ig.id}`, pageToken, {
        fields: 'username,followers_count,follows_count,media_count',
      }) as { username?: string; followers_count?: number; follows_count?: number; media_count?: number }

      const username = profile.username
      if (!username) continue

      const followers  = profile.followers_count ?? 0
      const following  = profile.follows_count ?? 0
      const mediaCount = profile.media_count ?? 0

      const { avgLikes, avgComments, engagement } = await getAvgEngagement(ig.id, pageToken, followers)

      await env.DB.prepare(`
        INSERT INTO instagram_accounts
          (id, username, followers, following, avg_likes, avg_comments, engagement_rate, media_count, facebook_page_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(username) DO UPDATE SET
          followers        = excluded.followers,
          following        = excluded.following,
          avg_likes        = excluded.avg_likes,
          avg_comments     = excluded.avg_comments,
          engagement_rate  = excluded.engagement_rate,
          media_count      = excluded.media_count,
          facebook_page_id = excluded.facebook_page_id,
          updated_at       = datetime('now')
      `).bind(newId(), username, followers, following, avgLikes, avgComments, engagement, mediaCount, page.id).run()

      updated++
    } catch {
      // conta individual falhou — continua as demais
    }
  }

  return updated
}

export async function updateTrends(env: Env) {
  const rssUrl = 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=BR'

  const r = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!r.ok) return 0

  const xml   = await r.text()
  const items = [...xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g)]
    .map(m => m[1].trim())
    .filter(t => !t.includes('Daily Search Trends'))
    .slice(0, 20)

  if (!items.length) return 0

  await env.DB.prepare(`DELETE FROM trends WHERE category = 'trending_br'`).run()

  const stmts = items.map(item =>
    env.DB.prepare(
      `INSERT INTO trends (id, category, type, content, updated_at) VALUES (?, 'trending_br', 'topic', ?, datetime('now'))`
    ).bind(newId(), item)
  )
  await env.DB.batch(stmts)

  return items.length
}

async function sendReportWhatsApp(env: Env, message: string): Promise<void> {
  const phone = env.ADMIN_WHATSAPP
  if (!phone || !env.ZAPI_INSTANCE || !env.ZAPI_TOKEN) return

  try {
    await fetch(
      `https://api.z-api.io/instances/${env.ZAPI_INSTANCE}/token/${env.ZAPI_TOKEN}/send-text`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `55${phone.replace(/\D/g, '')}`, message }),
      }
    )
  } catch { /* falha silenciosa */ }
}

export async function generateAndSendDailyReport(env: Env): Promise<void> {
  try {
    const report = await generateDailyReport(env)
    await sendReportWhatsApp(env, report.whatsapp_summary)
  } catch {
    // falha silenciosa
  }
}
