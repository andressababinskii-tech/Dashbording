import { Context } from 'hono'
import { ok, err, notFound } from './response'
import { Env } from './auth.middleware'

export async function getWhatsAppLink(c: Context<{ Bindings: Env }>) {
  const { clientId } = c.req.param()

  const row = await c.env.DB.prepare(`
    SELECT
      c.company_name, c.whatsapp,
      cy.name AS cycle_name, cy.start_date, cy.end_date,
      cy.lead_goal, cy.budget_brl,
      (SELECT SUM(leads_count) FROM daily_metrics WHERE cycle_id = cy.id) AS total_leads,
      (SELECT SUM(spend_brl)   FROM daily_metrics WHERE cycle_id = cy.id) AS total_spend
    FROM clients c
    JOIN cycles cy ON cy.client_id = c.id AND cy.status = 'active'
    WHERE c.id = ? AND c.is_active = 1
    LIMIT 1
  `).bind(clientId).first<{
    company_name: string; whatsapp: string | null
    cycle_name: string; start_date: string; end_date: string
    lead_goal: number; budget_brl: number
    total_leads: number | null; total_spend: number | null
  }>()

  if (!row) return notFound('Cliente ou ciclo ativo')

  const leads = row.total_leads ?? 0
  const spend = row.total_spend ?? 0
  const remaining = row.budget_brl - spend
  const cpl = leads > 0 ? spend / leads : 0
  const pct = row.lead_goal > 0 ? Math.round((leads / row.lead_goal) * 100) : 0

  const fmt = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
  const fmtDate = (d: string) => {
    const [y, m, day] = d.split('-')
    return `${day}/${m}/${y}`
  }

  const msg = [
    `📊 *Relatório de Resultados — ${row.company_name}*`,
    `📅 Ciclo: ${row.cycle_name} (${fmtDate(row.start_date)} a ${fmtDate(row.end_date)})`,
    ``,
    `🎯 Leads: *${leads}* de *${row.lead_goal}* (${pct}% da meta)`,
    `💰 CPL atual: *${fmt(cpl)}*`,
    `💳 Gasto: *${fmt(spend)}*`,
    `💵 Verba restante: *${fmt(remaining)}*`,
    ``,
    `Acesse seu dashboard para o histórico completo! 👆`,
  ].join('\n')

  const encoded = encodeURIComponent(msg)
  const number = row.whatsapp?.replace(/\D/g, '') ?? ''
  const link = number ? `https://wa.me/55${number}?text=${encoded}` : `https://wa.me/?text=${encoded}`

  return ok({ link, message: msg, whatsapp: row.whatsapp })
}

export async function sendZApiAlert(env: Env, phone: string, message: string): Promise<void> {
  if (!env.ZAPI_INSTANCE || !env.ZAPI_TOKEN) return

  try {
    await fetch(
      `https://api.z-api.io/instances/${env.ZAPI_INSTANCE}/token/${env.ZAPI_TOKEN}/send-text`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `55${phone.replace(/\D/g, '')}`, message }),
      }
    )
  } catch { /* silencia */ }
}

export async function sendAlert(c: Context<{ Bindings: Env }>) {
  const { clientId } = c.req.param()
  const body = await c.req.json<{ message?: string }>()

  const row = await c.env.DB.prepare(`
    SELECT c.company_name, c.whatsapp,
           cy.name AS cycle_name, cy.lead_goal, cy.budget_brl,
           (SELECT SUM(leads_count) FROM daily_metrics WHERE cycle_id = cy.id) AS total_leads,
           (SELECT SUM(spend_brl)   FROM daily_metrics WHERE cycle_id = cy.id) AS total_spend
    FROM clients c
    JOIN cycles cy ON cy.client_id = c.id AND cy.status = 'active'
    WHERE c.id = ? AND c.is_active = 1 LIMIT 1
  `).bind(clientId).first<{
    company_name: string; whatsapp: string | null; cycle_name: string
    lead_goal: number; budget_brl: number
    total_leads: number | null; total_spend: number | null
  }>()

  if (!row) return notFound('Cliente ou ciclo ativo')
  if (!row.whatsapp) return err('Cliente não tem WhatsApp cadastrado')

  const leads = row.total_leads ?? 0
  const spend = row.total_spend ?? 0
  const fmt = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)

  const defaultMsg = [
    `📊 *${row.company_name}* — Atualização do ciclo "${row.cycle_name}"`,
    `🎯 Leads: ${leads}/${row.lead_goal}`,
    `💰 CPL: ${fmt(leads > 0 ? spend / leads : 0)}`,
    `💵 Verba restante: ${fmt(row.budget_brl - spend)}`,
  ].join('\n')

  await sendZApiAlert(c.env, row.whatsapp, body.message ?? defaultMsg)
  return ok({ message: 'Alerta enviado via Z-API' })
}

export async function updateWhatsApp(c: Context<{ Bindings: Env }>) {
  const { clientId } = c.req.param()
  const { whatsapp } = await c.req.json<{ whatsapp: string }>()

  const client = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first()
  if (!client) return notFound('Cliente')

  await c.env.DB.prepare(
    "UPDATE clients SET whatsapp = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(whatsapp || null, clientId).run()

  return ok({ message: 'WhatsApp atualizado' })
}
