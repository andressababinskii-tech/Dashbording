import { Context } from 'hono'
import { Env } from './auth.middleware'
import { generateId as nanoid } from './id'
import { jsonOk } from './response'

type C = Context<{ Bindings: Env }>

export async function listTasks(c: C) {
  const status   = c.req.query('status')
  const month    = c.req.query('month')

  let sql = `SELECT t.*, c.name as client_name
             FROM tasks t
             LEFT JOIN clients c ON c.id = t.client_id`
  const conditions: string[] = []
  const params: any[]        = []

  if (status) { conditions.push(`t.status = ?`); params.push(status) }
  if (month)  { conditions.push(`strftime('%Y-%m', t.due_date) = ?`); params.push(month) }

  if (conditions.length) sql += ` WHERE ` + conditions.join(' AND ')
  sql += ` ORDER BY t.due_date ASC, t.priority DESC`

  const rows = await c.env.DB.prepare(sql).bind(...params).all()
  return jsonOk(c, rows.results)
}

export async function createTask(c: C) {
  const body = await c.req.json<{
    title: string; description?: string; priority?: string
    due_date?: string; client_id?: string; google_event_id?: string
    notion_board_url?: string
  }>()

  const id = nanoid()
  await c.env.DB.prepare(
    `INSERT INTO tasks (id,title,description,priority,due_date,client_id,google_event_id,notion_board_url)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.title, body.description ?? null,
    body.priority ?? 'medium', body.due_date ?? null,
    body.client_id ?? null, body.google_event_id ?? null,
    body.notion_board_url ?? null
  ).run()

  return jsonOk(c, { id })
}

export async function updateTask(c: C) {
  const id   = c.req.param('id')
  const body = await c.req.json<{
    title?: string; description?: string; status?: string
    priority?: string; due_date?: string; client_id?: string
  }>()

  await c.env.DB.prepare(
    `UPDATE tasks SET
       title=COALESCE(?,title), description=COALESCE(?,description),
       status=COALESCE(?,status), priority=COALESCE(?,priority),
       due_date=COALESCE(?,due_date), client_id=COALESCE(?,client_id),
       updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    body.title ?? null, body.description ?? null, body.status ?? null,
    body.priority ?? null, body.due_date ?? null,
    body.client_id !== undefined ? (body.client_id || null) : null,
    id
  ).run()

  return jsonOk(c, { id })
}

export async function deleteTask(c: C) {
  await c.env.DB.prepare(`DELETE FROM tasks WHERE id=?`).bind(c.req.param('id')).run()
  return jsonOk(c, { deleted: true })
}
