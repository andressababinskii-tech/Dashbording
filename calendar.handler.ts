import { Context } from 'hono'
import { Env } from './auth.middleware'
import { jsonOk, jsonErr } from './response'
import { newId } from './id'

// GET /api/admin/calendar?username=&month=2026-05
export async function listCalendar(c: Context<{ Bindings: Env }>) {
  const username = c.req.query('username') ?? null
  const month    = c.req.query('month') ?? null

  let query = `SELECT * FROM calendar_entries WHERE 1=1`
  const binds: (string | null)[] = []

  if (username) { query += ` AND username = ?`; binds.push(username) }
  if (month)    { query += ` AND scheduled_date LIKE ?`; binds.push(`${month}%`) }

  query += ` ORDER BY scheduled_date ASC LIMIT 500`

  const { results } = await c.env.DB.prepare(query).bind(...binds).all()
  return jsonOk(c, results)
}

// POST /api/admin/calendar  — criar entrada
export async function createCalendarEntry(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    username: string; scheduled_date: string; day_of_week?: string
    format?: string; theme?: string; caption?: string; hashtags?: string
    media_url?: string; status?: string
  }>()

  if (!body.username || !body.scheduled_date)
    return jsonErr(c, 'username e scheduled_date são obrigatórios', 400)

  const id = newId()
  await c.env.DB.prepare(`
    INSERT INTO calendar_entries
      (id, username, scheduled_date, day_of_week, format, theme, caption, hashtags, media_url, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, body.username, body.scheduled_date,
    body.day_of_week ?? null, body.format ?? null,
    body.theme ?? null, body.caption ?? null, body.hashtags ?? null,
    body.media_url ?? null, body.status ?? 'Rascunho'
  ).run()

  return jsonOk(c, { id })
}

// PATCH /api/admin/calendar/:id  — atualizar (todos os campos)
export async function updateCalendarEntry(c: Context<{ Bindings: Env }>) {
  const id   = c.req.param('id')
  const body = await c.req.json<{
    status?: string; caption?: string; hashtags?: string; theme?: string
    format?: string; scheduled_date?: string; media_url?: string
  }>()

  const sets: string[] = [`updated_at = datetime('now')`]
  const binds: unknown[] = []

  const add = (col: string, val: unknown) => {
    if (val !== undefined) { sets.push(`${col} = ?`); binds.push(val) }
  }
  add('status',         body.status)
  add('caption',        body.caption)
  add('hashtags',       body.hashtags)
  add('theme',          body.theme)
  add('format',         body.format)
  add('scheduled_date', body.scheduled_date)
  add('media_url',      body.media_url)

  binds.push(id)
  await c.env.DB.prepare(
    `UPDATE calendar_entries SET ${sets.join(', ')} WHERE id = ?`
  ).bind(...binds).run()

  // If Notion token is set, push update to Notion
  if (c.env.NOTION_TOKEN && body.status) {
    const entry = await c.env.DB.prepare(
      `SELECT * FROM calendar_entries WHERE id=?`
    ).bind(id).first<any>()
    if (entry?.notion_page_id) {
      await pushCalendarEntryToNotion(c.env, entry)
    }
  }

  return jsonOk(c, { id })
}

// DELETE /api/admin/calendar/:id
export async function deleteCalendarEntry(c: Context<{ Bindings: Env }>) {
  const id = c.req.param('id')
  await c.env.DB.prepare(`DELETE FROM calendar_entries WHERE id = ?`).bind(id).run()
  return jsonOk(c, { id })
}

// POST /api/admin/calendar/sync  — recebe batch do Python
export async function syncCalendar(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    username: string
    month: string
    entries: {
      scheduled_date: string; day_of_week: string
      format: string; theme: string; caption?: string; hashtags?: string
      notion_page_id?: string
    }[]
  }>()

  await c.env.DB.prepare(
    `DELETE FROM calendar_entries WHERE username = ? AND scheduled_date LIKE ?`
  ).bind(body.username, `${body.month}%`).run()

  const stmts = body.entries.map(e =>
    c.env.DB.prepare(`
      INSERT INTO calendar_entries (id, username, scheduled_date, day_of_week, format, theme, caption, hashtags, notion_page_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(newId(), body.username, e.scheduled_date, e.day_of_week, e.format, e.theme,
      e.caption ?? null, e.hashtags ?? null, e.notion_page_id ?? null)
  )

  if (stmts.length > 0) await c.env.DB.batch(stmts)
  return jsonOk(c, { username: body.username, month: body.month, count: stmts.length })
}

// POST /api/admin/calendar/sync-notion — pull from Notion directly (requires NOTION_TOKEN)
export async function syncCalendarFromNotion(c: Context<{ Bindings: Env }>) {
  if (!c.env.NOTION_TOKEN) {
    return jsonErr(c, 'NOTION_TOKEN não configurado. Execute: wrangler secret put NOTION_TOKEN', 400)
  }

  const username  = c.req.query('username')
  const month     = c.req.query('month') ?? new Date().toISOString().slice(0, 7)
  const pageId    = c.env.NOTION_PAGE_ID ?? '335cd9bc1c658142b2cfecfdd1f4a9e0'

  // Query Notion database for calendar entries
  const res = await fetch(`https://api.notion.com/v1/databases/${pageId}/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.NOTION_TOKEN}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filter: {
        and: [
          ...(username ? [{ property: 'Username', rich_text: { contains: username } }] : []),
        ],
      },
      page_size: 100,
    }),
  })

  if (!res.ok) {
    const txt = await res.text()
    return jsonErr(c, `Erro Notion: ${txt}`, 502)
  }

  const data: any = await res.json()
  const entries: any[] = []

  for (const page of data.results ?? []) {
    const props = page.properties ?? {}
    const getDate = (p: any) => p?.date?.start ?? null
    const getText = (p: any) => (p?.rich_text?.[0]?.plain_text ?? p?.title?.[0]?.plain_text ?? null)
    const getSelect = (p: any) => p?.select?.name ?? null

    const scheduled_date = getDate(props['Data agendada'] ?? props['Data'] ?? props['Scheduled Date'])
    if (!scheduled_date) continue

    entries.push({
      id: newId(),
      username: getText(props['Username'] ?? props['Conta'] ?? props['Account']) ?? username ?? '',
      scheduled_date,
      format:   getSelect(props['Formato'] ?? props['Format']) ?? null,
      theme:    getText(props['Tema'] ?? props['Theme'] ?? props['Assunto']) ?? null,
      caption:  getText(props['Legenda'] ?? props['Caption']) ?? null,
      hashtags: getText(props['Hashtags']) ?? null,
      status:   getSelect(props['Status']) ?? 'Rascunho',
      notion_page_id: page.id,
    })
  }

  if (entries.length > 0 && username) {
    await c.env.DB.prepare(
      `DELETE FROM calendar_entries WHERE username=? AND scheduled_date LIKE ?`
    ).bind(username, `${month}%`).run()

    const stmts = entries.map(e => c.env.DB.prepare(`
      INSERT OR REPLACE INTO calendar_entries
        (id, username, scheduled_date, format, theme, caption, hashtags, status, notion_page_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(e.id, e.username, e.scheduled_date, e.format, e.theme, e.caption, e.hashtags, e.status, e.notion_page_id))
    await c.env.DB.batch(stmts)
  }

  return jsonOk(c, { synced: entries.length, month })
}

// Internal: push a calendar entry update to Notion
async function pushCalendarEntryToNotion(env: Env, entry: any) {
  if (!entry.notion_page_id || !env.NOTION_TOKEN) return
  try {
    await fetch(`https://api.notion.com/v1/pages/${entry.notion_page_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          'Status': { select: { name: entry.status } },
          ...(entry.caption ? { 'Legenda': { rich_text: [{ text: { content: entry.caption } }] } } : {}),
        },
      }),
    })
  } catch { /* silently ignore */ }
}
