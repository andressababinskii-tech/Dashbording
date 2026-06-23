import { Context } from 'hono'
import { Env } from './auth.middleware'
import { jsonOk } from './response'
import { newId } from './id'

export async function getTrends(c: Context<{ Bindings: Env }>) {
  const category = c.req.query('category') ?? null

  const query = category
    ? `SELECT * FROM trends WHERE category = ? ORDER BY type, content LIMIT 200`
    : `SELECT * FROM trends ORDER BY category, type LIMIT 500`

  const { results } = category
    ? await c.env.DB.prepare(query).bind(category).all()
    : await c.env.DB.prepare(query).all()

  const grouped: Record<string, { top: string[]; rising: string[]; topics: string[]; musics: string[] }> = {}
  for (const row of results as { category: string; type: string; content: string }[]) {
    if (!grouped[row.category]) {
      grouped[row.category] = { top: [], rising: [], topics: [], musics: [] }
    }
    if (row.type === 'top')    grouped[row.category].top.push(row.content)
    if (row.type === 'rising') grouped[row.category].rising.push(row.content)
    if (row.type === 'topic')  grouped[row.category].topics.push(row.content)
    if (row.type === 'music')  grouped[row.category].musics.push(row.content)
  }

  const lastRow = await c.env.DB.prepare(
    `SELECT updated_at FROM trends ORDER BY updated_at DESC LIMIT 1`
  ).first<{ updated_at: string }>()

  return jsonOk(c, { grouped, last_updated: lastRow?.updated_at ?? null })
}

export async function syncTrendsNow(c: Context<{ Bindings: Env }>) {
  const { updateTrends } = await import('./cron.handler')
  try {
    await updateTrends(c.env)
    return jsonOk(c, { message: 'Tendências atualizadas com sucesso' })
  } catch (e: any) {
    return jsonOk(c, { message: 'Sync parcial', error: e?.message })
  }
}

export async function searchTrends(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ q: string }>()
  const q = body.q?.trim().replace(/^[@#]/, '').toLowerCase()
  if (!q) return jsonOk(c, [])

  const rows = await c.env.DB.prepare(
    `SELECT * FROM trends WHERE LOWER(content) LIKE ? ORDER BY type, category LIMIT 100`
  ).bind(`%${q}%`).all()

  return jsonOk(c, rows.results)
}

export async function syncTrends(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    category: string
    items: { type: 'top' | 'rising' | 'topic' | 'music'; content: string }[]
  }>()

  await c.env.DB.prepare(`DELETE FROM trends WHERE category = ?`).bind(body.category).run()

  const stmts = body.items.map(item =>
    c.env.DB.prepare(
      `INSERT INTO trends (id, category, type, content, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(newId(), body.category, item.type, item.content)
  )

  if (stmts.length > 0) await c.env.DB.batch(stmts)
  return jsonOk(c, { category: body.category, count: stmts.length })
}
