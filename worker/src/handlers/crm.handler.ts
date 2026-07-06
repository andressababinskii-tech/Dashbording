import { Context } from 'hono'
import { Env } from '../middleware/auth.middleware'
import { generateId as nanoid } from '../utils/id'
import { jsonOk } from '../utils/response'

type C = Context<{ Bindings: Env }>

const STAGES = ['prospeccao','contato','diagnostico','proposta','fechado','reuniao_mensal','perdido'] as const

// ── GET /api/admin/crm ────────────────────────────────────────────────────
export async function listLeads(c: C) {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM crm_leads ORDER BY updated_at DESC`
  ).all()

  // Group by stage
  const byStage: Record<string, any[]> = {}
  STAGES.forEach(s => (byStage[s] = []))
  for (const r of rows.results as any[]) {
    byStage[r.stage]?.push(r)
  }

  const total    = (rows.results as any[]).filter(r => r.stage !== 'perdido').length
  const fechados = (rows.results as any[]).filter(r => r.stage === 'fechado').length
  const totalValue = (rows.results as any[])
    .filter(r => r.stage === 'fechado')
    .reduce((s, r) => s + (r.value ?? 0), 0)

  return jsonOk(c, {
    leads: rows.results,
    byStage,
    stats: {
      total,
      fechados,
      conversion: total ? ((fechados / total) * 100).toFixed(1) : '0',
      totalValue,
    },
  })
}

// ── POST /api/admin/crm ───────────────────────────────────────────────────
export async function createLead(c: C) {
  const body = await c.req.json<{
    name: string; company?: string; email?: string; phone?: string
    stage?: string; value?: number; notes?: string; appointment_date?: string
  }>()

  const id = nanoid()
  await c.env.DB.prepare(
    `INSERT INTO crm_leads (id,name,company,email,phone,stage,value,notes,appointment_date)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, body.name, body.company ?? null, body.email ?? null,
    body.phone ?? null, body.stage ?? 'prospeccao',
    body.value ?? 0, body.notes ?? null, body.appointment_date ?? null
  ).run()

  return jsonOk(c, { id })
}

// ── PUT /api/admin/crm/:id ────────────────────────────────────────────────
export async function updateLead(c: C) {
  const id   = c.req.param('id')
  const body = await c.req.json<{
    name?: string; company?: string; email?: string; phone?: string
    stage?: string; value?: number; notes?: string; appointment_date?: string
  }>()

  await c.env.DB.prepare(
    `UPDATE crm_leads SET
       name=COALESCE(?,name), company=COALESCE(?,company),
       email=COALESCE(?,email), phone=COALESCE(?,phone),
       stage=COALESCE(?,stage), value=COALESCE(?,value),
       notes=COALESCE(?,notes), appointment_date=COALESCE(?,appointment_date),
       updated_at=datetime('now')
     WHERE id=?`
  ).bind(
    body.name ?? null, body.company ?? null, body.email ?? null,
    body.phone ?? null, body.stage ?? null,
    body.value ?? null, body.notes ?? null, body.appointment_date ?? null, id
  ).run()

  return jsonOk(c, { id })
}

// ── DELETE /api/admin/crm/:id ─────────────────────────────────────────────
export async function deleteLead(c: C) {
  await c.env.DB.prepare(`DELETE FROM crm_leads WHERE id=?`).bind(c.req.param('id')).run()
  return jsonOk(c, { deleted: true })
}

// ── GET /api/admin/crm/:id/interactions ───────────────────────────────────
export async function listInteractions(c: C) {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM crm_interactions WHERE lead_id=? ORDER BY created_at DESC`
  ).bind(c.req.param('id')).all()
  return jsonOk(c, rows.results)
}

// ── POST /api/admin/crm/:id/interactions ──────────────────────────────────
export async function addInteraction(c: C) {
  const leadId = c.req.param('id')
  const body   = await c.req.json<{ type: string; content: string }>()
  const id     = nanoid()

  await c.env.DB.prepare(
    `INSERT INTO crm_interactions (id,lead_id,type,content) VALUES (?,?,?,?)`
  ).bind(id, leadId, body.type, body.content).run()

  await c.env.DB.prepare(
    `UPDATE crm_leads SET updated_at=datetime('now') WHERE id=?`
  ).bind(leadId).run()

  return jsonOk(c, { id })
}
