import { Context } from 'hono'
import { ok, created, err, notFound } from './response'
import { generateId } from './id'
import { Env } from './auth.middleware'

export async function listCycles(c: Context<{ Bindings: Env }>) {
  const { clientId } = c.req.param()
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM cycles WHERE client_id = ? ORDER BY start_date DESC`
  ).bind(clientId).all()
  return ok(results)
}

export async function getCycle(c: Context<{ Bindings: Env }>) {
  const { cycleId } = c.req.param()
  const user = c.get('user')

  let query = 'SELECT * FROM cycles WHERE id = ?'
  const binds: unknown[] = [cycleId]

  if (user.role === 'client') {
    query += ' AND client_id = ?'
    binds.push(user.clientId)
  }

  const cycle = await c.env.DB.prepare(query).bind(...binds).first()
  if (!cycle) return notFound('Ciclo')
  return ok(cycle)
}

export async function createCycle(c: Context<{ Bindings: Env }>) {
  const { clientId } = c.req.param()
  const body = await c.req.json<{
    name: string; start_date: string; end_date: string
    lead_goal: number; budget_brl: number; notes?: string
  }>()

  if (!body.name || !body.start_date || !body.end_date || body.lead_goal == null || body.budget_brl == null) {
    return err('Campos obrigatórios: name, start_date, end_date, lead_goal, budget_brl')
  }
  if (new Date(body.start_date) >= new Date(body.end_date)) {
    return err('Data de início deve ser anterior à data de fim')
  }

  const client = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ? AND is_active = 1').bind(clientId).first()
  if (!client) return notFound('Cliente')

  const id = generateId()
  await c.env.DB.prepare(
    `INSERT INTO cycles (id, client_id, name, start_date, end_date, lead_goal, budget_brl, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, clientId, body.name, body.start_date, body.end_date,
    body.lead_goal, body.budget_brl, body.notes ?? null).run()

  return created({ id, message: 'Ciclo criado com sucesso' })
}

export async function updateCycle(c: Context<{ Bindings: Env }>) {
  const { cycleId } = c.req.param()
  const body = await c.req.json<{
    name?: string; start_date?: string; end_date?: string
    lead_goal?: number; budget_brl?: number; status?: string; notes?: string
  }>()

  const cycle = await c.env.DB.prepare('SELECT id FROM cycles WHERE id = ?').bind(cycleId).first()
  if (!cycle) return notFound('Ciclo')

  await c.env.DB.prepare(
    `UPDATE cycles SET
      name = COALESCE(?, name),
      start_date = COALESCE(?, start_date),
      end_date = COALESCE(?, end_date),
      lead_goal = COALESCE(?, lead_goal),
      budget_brl = COALESCE(?, budget_brl),
      status = COALESCE(?, status),
      notes = COALESCE(?, notes),
      updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    body.name ?? null, body.start_date ?? null, body.end_date ?? null,
    body.lead_goal ?? null, body.budget_brl ?? null, body.status ?? null,
    body.notes ?? null, cycleId
  ).run()

  return ok({ message: 'Ciclo atualizado com sucesso' })
}

export async function deleteCycle(c: Context<{ Bindings: Env }>) {
  const { cycleId } = c.req.param()
  const cycle = await c.env.DB.prepare('SELECT id FROM cycles WHERE id = ?').bind(cycleId).first()
  if (!cycle) return notFound('Ciclo')

  await c.env.DB.prepare('DELETE FROM cycles WHERE id = ?').bind(cycleId).run()
  return ok({ message: 'Ciclo excluído com sucesso' })
}
