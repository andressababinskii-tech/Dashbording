import { Context } from 'hono'
import { ok, err, notFound } from './response'
import { Env } from './auth.middleware'

function calcProjection(leadsNow: number, daysPassed: number, totalDays: number): number {
  if (daysPassed === 0) return 0
  return Math.round((leadsNow / daysPassed) * totalDays)
}

export async function getMyDashboard(c: Context<{ Bindings: Env }>) {
  const user = c.get('user')
  if (!user.clientId) return err('Usuário sem cliente associado', 400)

  // Ciclo ativo
  const activeCycle = await c.env.DB.prepare(
    `SELECT * FROM cycles
     WHERE client_id = ? AND status = 'active'
     ORDER BY start_date DESC LIMIT 1`
  ).bind(user.clientId).first<{
    id: string; name: string; start_date: string; end_date: string
    lead_goal: number; budget_brl: number; notes: string
  }>()

  if (!activeCycle) {
    return ok({ hasCycle: false, client: null, cycle: null, metrics: null })
  }

  // Métricas do ciclo ativo
  const [metricsResult, adjustmentsResult, clientResult] = await Promise.all([
    c.env.DB.prepare(
      'SELECT * FROM daily_metrics WHERE cycle_id = ? ORDER BY metric_date ASC'
    ).bind(activeCycle.id).all(),
    c.env.DB.prepare(
      'SELECT SUM(amount_brl) as total FROM budget_adjustments WHERE cycle_id = ?'
    ).bind(activeCycle.id).first<{ total: number | null }>(),
    c.env.DB.prepare(
      'SELECT id, name, company_name, segment, accent_color, logo_url, whatsapp, instagram_username FROM clients WHERE id = ?'
    ).bind(user.clientId).first<{ instagram_username: string | null; [key: string]: unknown }>(),
  ])

  const dailyMetrics = metricsResult.results as Array<{
    metric_date: string; leads_count: number; spend_brl: number; impressions: number; clicks: number
  }>

  const totalLeads = dailyMetrics.reduce((s, m) => s + m.leads_count, 0)
  const totalSpend = dailyMetrics.reduce((s, m) => s + m.spend_brl, 0)
  const budgetAdjustments = adjustmentsResult?.total ?? 0
  const effectiveBudget = activeCycle.budget_brl + budgetAdjustments
  const remainingBudget = effectiveBudget - totalSpend
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0

  const today = new Date().toISOString().split('T')[0]
  const startDate = new Date(activeCycle.start_date)
  const endDate = new Date(activeCycle.end_date)
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000))
  const daysPassed = Math.max(0, Math.ceil((new Date(today).getTime() - startDate.getTime()) / 86400000))
  const daysRemaining = Math.max(0, totalDays - daysPassed)

  const projectedLeads = calcProjection(totalLeads, daysPassed, totalDays)
  const projectedCpl = projectedLeads > 0 ? effectiveBudget / projectedLeads : 0
  const dailyLeadsNeeded = daysRemaining > 0 ? Math.ceil((activeCycle.lead_goal - totalLeads) / daysRemaining) : 0

  // Dados do Instagram vinculado ao cliente
  let instagramData = null
  if (clientResult?.instagram_username) {
    instagramData = await c.env.DB.prepare(
      `SELECT username, followers, following, avg_likes, avg_comments, engagement_rate,
              posts_scheduled, posts_published, last_report_date, nicho
       FROM instagram_accounts WHERE username = ?`
    ).bind(clientResult.instagram_username).first()
  }

  return ok({
    hasCycle: true,
    client: clientResult,
    instagram: instagramData,
    cycle: {
      ...activeCycle,
      effectiveBudget,
      budgetAdjustments,
    },
    summary: {
      totalLeads,
      leadGoal: activeCycle.lead_goal,
      leadGoalPercent: activeCycle.lead_goal > 0 ? Math.round((totalLeads / activeCycle.lead_goal) * 100) : 0,
      leadsRemaining: Math.max(0, activeCycle.lead_goal - totalLeads),
      totalSpend,
      remainingBudget,
      cpl: Math.round(cpl * 100) / 100,
      projectedLeads,
      projectedCpl: Math.round(projectedCpl * 100) / 100,
      dailyLeadsNeeded,
      daysPassed,
      daysRemaining,
      totalDays,
    },
    dailyMetrics,
  })
}

export async function getMyCycles(c: Context<{ Bindings: Env }>) {
  const user = c.get('user')
  if (!user.clientId) return err('Usuário sem cliente associado', 400)

  const { results } = await c.env.DB.prepare(
    `SELECT c.*,
       (SELECT SUM(leads_count) FROM daily_metrics WHERE cycle_id = c.id) as total_leads,
       (SELECT SUM(spend_brl) FROM daily_metrics WHERE cycle_id = c.id) as total_spend
     FROM cycles c
     WHERE c.client_id = ?
     ORDER BY c.start_date DESC`
  ).bind(user.clientId).all()

  return ok(results)
}

export async function getMyCycleDetail(c: Context<{ Bindings: Env }>) {
  const user = c.get('user')
  const { cycleId } = c.req.param()
  if (!user.clientId) return err('Usuário sem cliente associado', 400)

  const cycle = await c.env.DB.prepare(
    'SELECT * FROM cycles WHERE id = ? AND client_id = ?'
  ).bind(cycleId, user.clientId).first()
  if (!cycle) return notFound('Ciclo')

  const { results: metrics } = await c.env.DB.prepare(
    'SELECT * FROM daily_metrics WHERE cycle_id = ? ORDER BY metric_date ASC'
  ).bind(cycleId).all()

  return ok({ cycle, metrics })
}
