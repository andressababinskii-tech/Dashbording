import { Context } from 'hono'
import { Env } from '../middleware/auth.middleware'
import { jsonOk, jsonErr } from '../utils/response'
import { newId } from '../utils/id'

type C = Context<{ Bindings: Env }>

// GET /api/admin/clients/:clientId/documents
export async function listDocuments(c: C) {
  const clientId = c.req.param('clientId')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM client_documents WHERE client_id = ? ORDER BY created_at DESC`
  ).bind(clientId).all()
  return jsonOk(c, results)
}

// POST /api/admin/clients/:clientId/documents
export async function createDocument(c: C) {
  const clientId = c.req.param('clientId')
  const body = await c.req.json<{ title: string; type?: string; content?: string }>()
  if (!body.title) return jsonErr(c, 'title é obrigatório', 400)

  const id = newId()
  await c.env.DB.prepare(
    `INSERT INTO client_documents (id, client_id, title, type, content) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, clientId, body.title, body.type ?? 'doc', body.content ?? null).run()
  return jsonOk(c, { id })
}

// PUT /api/admin/clients/:clientId/documents/:docId
export async function updateDocument(c: C) {
  const docId = c.req.param('docId')
  const body = await c.req.json<{ title?: string; type?: string; content?: string }>()

  await c.env.DB.prepare(
    `UPDATE client_documents SET
       title = COALESCE(?, title),
       type = COALESCE(?, type),
       content = COALESCE(?, content),
       updated_at = datetime('now')
     WHERE id = ?`
  ).bind(body.title ?? null, body.type ?? null, body.content ?? null, docId).run()
  return jsonOk(c, { id: docId })
}

// DELETE /api/admin/clients/:clientId/documents/:docId
export async function deleteDocument(c: C) {
  const docId = c.req.param('docId')
  await c.env.DB.prepare(`DELETE FROM client_documents WHERE id = ?`).bind(docId).run()
  return jsonOk(c, { deleted: true })
}
