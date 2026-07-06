import { Context } from 'hono'
import { ok, created, err, notFound } from '../utils/response'
import { generateId } from '../utils/id'
import { Env } from '../middleware/auth.middleware'

export async function listMetrics(c: Context<{ Bindings: Env }>) {
  const { cycleId } = c.req.param()
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM daily_metrics WHERE cycle_id = ? ORDER BY metric_date ASC`
  ).bind(cycleId).all()
  return ok(results)
}

export async function upsertMetric(c: Context<{ Bindings: Env }>) {
  const { cycleId } = c.req.param()
  const body = await c.req.json<{
    metric_date: string; leads_count: number; spend_brl: number
    impressions?: number; clicks?: number; notes?: string
  }>()

  if (!body.metric_date || body.leads_count == null || body.spend_brl == null) {
    return err('Campos obrigatórios: metric_date, leads_count, spend_brl')
  }

  const cycle = await c.env.DB.prepare(
    'SELECT id, client_id FROM cycles WHERE id = ?'
  ).bind(cycleId).first<{ id: string; client_id: string }>()
  if (!cycle) return notFound('Ciclo')

  const id = generateId()
  await c.env.DB.prepare(
    `INSERT INTO daily_metrics (id, cycle_id, client_id, metric_date, leads_count, spend_brl, impressions, clicks, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cycle_id, metric_date) DO UPDATE SET
       leads_count = excluded.leads_count,
       spend_brl = excluded.spend_brl,
       impressions = excluded.impressions,
       clicks = excluded.clicks,
       notes = excluded.notes`
  ).bind(
    id, cycleId, cycle.client_id, body.metric_date,
    body.leads_count, body.spend_brl,
    body.impressions ?? 0, body.clicks ?? 0, body.notes ?? null
  ).run()

  return created({ message: 'Métrica salva com sucesso' })
}

export async function addBudgetAdjustment(c: Context<{ Bindings: Env }>) {
  const { cycleId } = c.req.param()
  const user = c.get('user')
  const body = await c.req.json<{ amount_brl: number; reason?: string }>()

  if (body.amount_brl == null || body.amount_brl === 0) {
    return err('Valor do ajuste é obrigatório e não pode ser zero')
  }

  const cycle = await c.env.DB.prepare(
    'SELECT id, client_id FROM cycles WHERE id = ?'
  ).bind(cycleId).first<{ id: string; client_id: string }>()
  if (!cycle) return notFound('Ciclo')

  const id = generateId()
  await c.env.DB.prepare(
    `INSERT INTO budget_adjustments (id, cycle_id, client_id, amount_brl, reason, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, cycleId, cycle.client_id, body.amount_brl, body.reason ?? null, user.sub).run()

  return created({ message: 'Ajuste de verba registrado com sucesso' })
}
