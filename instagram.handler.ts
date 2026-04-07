import { Context } from 'hono'
import { Env } from '../middleware/auth.middleware'
import { jsonOk, jsonErr } from '../utils/response'
import { newId } from '../utils/id'

// GET /api/admin/instagram
export async function listInstagramAccounts(c: Context<{ Bindings: Env }>) {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM instagram_accounts ORDER BY is_active DESC, username ASC`
  ).all()
  return jsonOk(c, results)
}

// PUT /api/admin/instagram/:username  — upsert (usado pelo sync Python)
export async function upsertInstagramAccount(c: Context<{ Bindings: Env }>) {
  const username = c.req.param('username')
  const body = await c.req.json<{
    nicho?: string
    followers?: number
    following?: number
    avg_likes?: number
    avg_comments?: number
    engagement_rate?: number
    posts_scheduled?: number
    posts_published?: number
    last_report_date?: string
    is_active?: number
  }>()

  await c.env.DB.prepare(`
    INSERT INTO instagram_accounts
      (id, username, nicho, followers, following, avg_likes, avg_comments,
       engagement_rate, posts_scheduled, posts_published, last_report_date, is_active, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(username) DO UPDATE SET
      nicho            = excluded.nicho,
      followers        = excluded.followers,
      following        = excluded.following,
      avg_likes        = excluded.avg_likes,
      avg_comments     = excluded.avg_comments,
      engagement_rate  = excluded.engagement_rate,
      posts_scheduled  = excluded.posts_scheduled,
      posts_published  = excluded.posts_published,
      last_report_date = excluded.last_report_date,
      is_active        = excluded.is_active,
      updated_at       = datetime('now')
  `).bind(
    newId(), username,
    body.nicho ?? null,
    body.followers ?? 0,
    body.following ?? 0,
    body.avg_likes ?? 0,
    body.avg_comments ?? 0,
    body.engagement_rate ?? 0,
    body.posts_scheduled ?? 0,
    body.posts_published ?? 0,
    body.last_report_date ?? null,
    body.is_active ?? 1,
  ).run()

  return jsonOk(c, { username })
}

// GET /api/admin/instagram/:username  — detalhe completo da conta
export async function getInstagramAccount(c: Context<{ Bindings: Env }>) {
  const username = c.req.param('username')

  const account = await c.env.DB.prepare(
    `SELECT * FROM instagram_accounts WHERE username = ?`
  ).bind(username).first() as Record<string, unknown> | null
  if (!account) return jsonErr(c, 'Conta não encontrada', 404)

  // Últimas entradas do calendário (próximos 30 dias)
  const { results: calendar } = await c.env.DB.prepare(
    `SELECT scheduled_date, day_of_week, format, theme, caption, status
     FROM calendar_entries
     WHERE username = ? AND scheduled_date >= date('now')
     ORDER BY scheduled_date ASC LIMIT 20`
  ).bind(username).all()

  // Tendências do nicho desta conta
  const nicho = account.username as string
  const { results: trends } = await c.env.DB.prepare(
    `SELECT type, content FROM trends WHERE category = ? ORDER BY updated_at DESC LIMIT 20`
  ).bind(nicho).all()

  // Melhores posts da semana via Graph API
  let topPosts: unknown[] = []
  const pageId = account.facebook_page_id as string | null
  if (pageId && c.env.FB_USER_TOKEN) {
    try {
      const ptResp = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${c.env.FB_USER_TOKEN}`
      )
      const ptData = await ptResp.json() as { access_token?: string }
      const pageToken = ptData.access_token ?? c.env.FB_USER_TOKEN

      // Buscar ID da conta Instagram
      const igResp = await fetch(
        `https://graph.facebook.com/v21.0/${pageId}?fields=instagram_business_account&access_token=${pageToken}`
      )
      const igData = await igResp.json() as { instagram_business_account?: { id: string } }
      const igId = igData.instagram_business_account?.id

      if (igId) {
        const mediaResp = await fetch(
          `https://graph.facebook.com/v21.0/${igId}/media?fields=id,caption,media_type,thumbnail_url,media_url,permalink,like_count,comments_count,timestamp&limit=12&access_token=${pageToken}`
        )
        const mediaData = await mediaResp.json() as { data?: unknown[] }
        const posts = (mediaData.data ?? []) as Array<{
          like_count?: number; comments_count?: number; timestamp?: string
        }>

        // Filtrar última semana e ordenar por engajamento
        const oneWeekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
        topPosts = posts
          .filter(p => (p.timestamp ?? '') >= oneWeekAgo)
          .sort((a, b) => ((b.like_count ?? 0) + (b.comments_count ?? 0)) - ((a.like_count ?? 0) + (a.comments_count ?? 0)))
          .slice(0, 6)
      }
    } catch {
      // falha silenciosa — retorna sem top posts
    }
  }

  return jsonOk(c, { account, calendar, trends, topPosts })
}

// DELETE /api/admin/instagram/:username
export async function deleteInstagramAccount(c: Context<{ Bindings: Env }>) {
  const username = c.req.param('username')
  await c.env.DB.prepare(
    `DELETE FROM instagram_accounts WHERE username = ?`
  ).bind(username).run()
  return jsonOk(c, { username })
}

// PATCH /api/admin/instagram/:username/status
export async function toggleInstagramStatus(c: Context<{ Bindings: Env }>) {
  const username = c.req.param('username')
  const { is_active } = await c.req.json<{ is_active: number }>()
  await c.env.DB.prepare(
    `UPDATE instagram_accounts SET is_active = ?, updated_at = datetime('now') WHERE username = ?`
  ).bind(is_active, username).run()
  return jsonOk(c, { username, is_active })
}
