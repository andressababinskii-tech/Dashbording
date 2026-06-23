import { Context } from 'hono'
import { Env } from './auth.middleware'
import { generateId as nanoid } from './id'
import { jsonOk } from './response'

type C = Context<{ Bindings: Env }>

export async function listProjects(c: C) {
  const rows = await c.env.DB.prepare(`
    SELECT p.*, c.name as client_name,
      (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id=p.id) as total_tasks,
      (SELECT COUNT(*) FROM project_tasks pt WHERE pt.project_id=p.id AND pt.done=1) as done_tasks
    FROM projects p
    LEFT JOIN clients c ON c.id=p.client_id
    ORDER BY p.deadline ASC NULLS LAST, p.created_at DESC
  `).all()

  return jsonOk(c, rows.results)
}

export async function createProject(c: C) {
  const body = await c.req.json<{
    client_id?: string; name: string; description?: string
    deadline?: string; notion_url?: string
  }>()

  const id = nanoid()
  await c.env.DB.prepare(
    `INSERT INTO projects (id,client_id,name,description,deadline,notion_url)
     VALUES (?,?,?,?,?,?)`
  ).bind(
    id, body.client_id ?? null, body.name,
    body.description ?? null, body.deadline ?? null,
    body.notion_url ?? null
  ).run()

  return jsonOk(c, { id })
}

export async function updateProject(c: C) {
  const id   = c.req.param('id')
  const body = await c.req.json<{
    name?: string; description?: string; status?: string
    deadline?: string; notion_url?: string; client_id?: string
  }>()

  await c.env.DB.prepare(
    `UPDATE projects SET
       name=COALESCE(?,name), description=COALESCE(?,description),
       status=COALESCE(?,status), deadline=COALESCE(?,deadline),
       notion_url=COALESCE(?,notion_url),
       client_id=COALESCE(?,client_id),
       updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    body.name ?? null, body.description ?? null, body.status ?? null,
    body.deadline ?? null, body.notion_url ?? null,
    body.client_id !== undefined ? (body.client_id || null) : null,
    id
  ).run()

  return jsonOk(c, { ok: true })
}

export async function deleteProject(c: C) {
  await c.env.DB.prepare(`DELETE FROM projects WHERE id=?`).bind(c.req.param('id')).run()
  return jsonOk(c, { ok: true })
}

export async function listProjectTasks(c: C) {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM project_tasks WHERE project_id=? ORDER BY order_index, created_at`
  ).bind(c.req.param('id')).all()
  return jsonOk(c, rows.results)
}

export async function createProjectTask(c: C) {
  const projectId = c.req.param('id')
  const body = await c.req.json<{ title: string; due_date?: string; order_index?: number }>()
  const id   = nanoid()

  await c.env.DB.prepare(
    `INSERT INTO project_tasks (id,project_id,title,due_date,order_index)
     VALUES (?,?,?,?,?)`
  ).bind(id, projectId, body.title, body.due_date ?? null, body.order_index ?? 0).run()

  await c.env.DB.prepare(
    `UPDATE projects SET updated_at=datetime('now') WHERE id=?`
  ).bind(projectId).run()

  return jsonOk(c, { id })
}

export async function updateProjectTask(c: C) {
  const taskId = c.req.param('taskId')
  const body   = await c.req.json<{ title?: string; done?: boolean; due_date?: string }>()

  await c.env.DB.prepare(
    `UPDATE project_tasks SET
       title=COALESCE(?,title),
       done=COALESCE(?,done),
       due_date=COALESCE(?,due_date)
     WHERE id=?`
  ).bind(
    body.title ?? null,
    body.done !== undefined ? (body.done ? 1 : 0) : null,
    body.due_date !== undefined ? (body.due_date || null) : null,
    taskId
  ).run()

  return jsonOk(c, { ok: true })
}

export async function deleteProjectTask(c: C) {
  await c.env.DB.prepare(
    `DELETE FROM project_tasks WHERE id=?`
  ).bind(c.req.param('taskId')).run()
  return jsonOk(c, { ok: true })
}
