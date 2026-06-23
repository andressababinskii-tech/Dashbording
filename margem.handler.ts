import { Context } from 'hono'
import { Env } from './auth.middleware'
import { generateId as nanoid } from './id'
import { jsonOk } from './response'

type C = Context<{ Bindings: Env }>

function calcMargins(row: any) {
  const gross     = row.gross_revenue ?? 0
  const costs     = (row.fixed_costs ?? 0) + (row.variable_costs ?? 0) + (row.taxes ?? 0)
  const net       = gross - costs
  const grossMgn  = gross ? ((gross - (row.fixed_costs ?? 0) - (row.variable_costs ?? 0)) / gross * 100) : 0
  const netMgn    = gross ? (net / gross * 100) : 0
  const breakeven = (row.fixed_costs ?? 0) > 0
    ? row.fixed_costs / (gross > 0 ? (1 - (row.variable_costs ?? 0) / gross) : 1)
    : 0
  return {
    ...row,
    net_revenue: net,
    gross_margin: +grossMgn.toFixed(2),
    net_margin: +netMgn.toFixed(2),
    breakeven: +breakeven.toFixed(2),
    below_goal: netMgn < (row.goal_margin ?? 30),
  }
}

export async function listMargens(c: C) {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM profit_margins ORDER BY month DESC LIMIT 12`
  ).all()

  const results = (rows.results as any[]).map(calcMargins)
  const chart = results.slice(0, 6).reverse()

  return jsonOk(c, { months: results, chart })
}

export async function upsertMargem(c: C) {
  const body = await c.req.json<{
    month: string
    gross_revenue?: number; fixed_costs?: number
    variable_costs?: number; taxes?: number; goal_margin?: number
  }>()

  const existing = await c.env.DB.prepare(
    `SELECT id FROM profit_margins WHERE month=?`
  ).bind(body.month).first()

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE profit_margins SET
         gross_revenue=COALESCE(?,gross_revenue),
         fixed_costs=COALESCE(?,fixed_costs),
         variable_costs=COALESCE(?,variable_costs),
         taxes=COALESCE(?,taxes),
         goal_margin=COALESCE(?,goal_margin),
         updated_at=datetime('now')
       WHERE month=?`
    ).bind(
      body.gross_revenue ?? null, body.fixed_costs ?? null,
      body.variable_costs ?? null, body.taxes ?? null,
      body.goal_margin ?? null, body.month
    ).run()
    return jsonOk(c, { id: (existing as any).id })
  }

  const id = nanoid()
  await c.env.DB.prepare(
    `INSERT INTO profit_margins (id,month,gross_revenue,fixed_costs,variable_costs,taxes,goal_margin)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(
    id, body.month,
    body.gross_revenue ?? 0, body.fixed_costs ?? 0,
    body.variable_costs ?? 0, body.taxes ?? 0,
    body.goal_margin ?? 30
  ).run()

  return jsonOk(c, { id })
}
