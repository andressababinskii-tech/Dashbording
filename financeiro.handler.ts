import { Context } from 'hono'
import { Env } from './auth.middleware'
import { generateId as nanoid } from './id'
import { jsonOk } from './response'

type C = Context<{ Bindings: Env }>

// ── GET /api/admin/financeiro?month=YYYY-MM ────────────────────────────────
export async function getFinanceiro(c: C) {
  const month = c.req.query('month') ?? new Date().toISOString().slice(0, 7)

  // Entries do mês
  const entries = await c.env.DB.prepare(
    `SELECT * FROM financial_entries WHERE strftime('%Y-%m', date) = ? ORDER BY date DESC`
  ).bind(month).all()

  // Resumo dos últimos 6 meses
  const chart = await c.env.DB.prepare(`
    SELECT
      strftime('%Y-%m', date) as month,
      SUM(CASE WHEN type='income'  THEN amount ELSE 0 END) as income,
      SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense
    FROM financial_entries
    WHERE date >= date('now','-6 months')
    GROUP BY month
    ORDER BY month
  `).all()

  // Recorrentes ativos
  const recurring = await c.env.DB.prepare(
    `SELECT * FROM financial_entries WHERE recurring=1 ORDER BY category, description`
  ).all()

  const income  = (entries.results as any[]).filter(e => e.type === 'income' ).reduce((s, e) => s + e.amount, 0)
  const expense = (entries.results as any[]).filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0)

  return jsonOk(c, {
    month,
    summary: { income, expense, net: income - expense },
    entries: entries.results,
    chart: chart.results,
    recurring: recurring.results,
  })
}

// ── POST /api/admin/financeiro ─────────────────────────────────────────────
export async function createEntry(c: C) {
  const body = await c.req.json<{
    type: string; category: string; description?: string
    amount: number; date: string; recurring?: boolean
  }>()

  const id = nanoid()
  await c.env.DB.prepare(
    `INSERT INTO financial_entries (id,type,category,description,amount,date,recurring)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(id, body.type, body.category, body.description ?? null, body.amount, body.date, body.recurring ? 1 : 0).run()

  return jsonOk(c, { id })
}

// ── PUT /api/admin/financeiro/:id ──────────────────────────────────────────
export async function updateEntry(c: C) {
  const id   = c.req.param('id')
  const body = await c.req.json<{
    type?: string; category?: string; description?: string
    amount?: number; date?: string; recurring?: boolean
  }>()

  await c.env.DB.prepare(
    `UPDATE financial_entries SET
       type=COALESCE(?,type), category=COALESCE(?,category),
       description=COALESCE(?,description), amount=COALESCE(?,amount),
       date=COALESCE(?,date), recurring=COALESCE(?,recurring)
     WHERE id=?`
  ).bind(
    body.type ?? null, body.category ?? null, body.description ?? null,
    body.amount ?? null, body.date ?? null,
    body.recurring !== undefined ? (body.recurring ? 1 : 0) : null,
    id
  ).run()

  return jsonOk(c, { id })
}

// ── DELETE /api/admin/financeiro/:id ──────────────────────────────────────
export async function deleteEntry(c: C) {
  await c.env.DB.prepare(`DELETE FROM financial_entries WHERE id=?`).bind(c.req.param('id')).run()
  return jsonOk(c, { deleted: true })
}
