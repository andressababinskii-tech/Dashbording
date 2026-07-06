import { Context } from 'hono'
import { hash } from 'bcryptjs'
import { ok, created, err, notFound } from '../utils/response'
import { generateId } from '../utils/id'
import { Env } from '../middleware/auth.middleware'

export async function listClients(c: Context<{ Bindings: Env }>) {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, u.email as login_email, u.id as user_id, u.is_active as user_active
     FROM clients c
     LEFT JOIN users u ON u.client_id = c.id AND u.role = 'client'
     WHERE c.is_active = 1
     ORDER BY c.name ASC`
  ).all()
  return ok(results)
}

export async function getClient(c: Context<{ Bindings: Env }>) {
  const p = c.req.param() as any
  const id = p.id ?? p.clientId
  const client = await c.env.DB.prepare(
    `SELECT c.*, u.email as login_email, u.id as user_id
     FROM clients c
     LEFT JOIN users u ON u.client_id = c.id AND u.role = 'client'
     WHERE c.id = ?`
  ).bind(id).first()

  if (!client) return notFound('Cliente')
  return ok(client)
}

export async function createClient(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{
    name: string; company_name: string; email: string; phone?: string
    segment?: string; accent_color?: string; whatsapp?: string
    instagram_username?: string
    login_email: string; login_password: string
  }>()

  if (!body.name || !body.company_name || !body.email || !body.login_email || !body.login_password) {
    return err('Campos obrigatórios: name, company_name, email, login_email, login_password')
  }
  if (body.login_password.length < 8) {
    return err('Senha do login deve ter pelo menos 8 caracteres')
  }

  // Verifica se o email de login já existe
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ?'
  ).bind(body.login_email.toLowerCase()).first()
  if (existing) return err('Email de login já cadastrado')

  const clientId = generateId()
  const userId = generateId()
  const passwordHash = await hash(body.login_password, 10)
  const igUsername = body.instagram_username?.replace(/^@/, '').trim() || null

  const crmId = generateId()
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO clients (id, name, company_name, email, phone, segment, accent_color, whatsapp, instagram_username)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(clientId, body.name, body.company_name, body.email,
      body.phone ?? null, body.segment ?? null, body.accent_color ?? '#3B82F6',
      body.whatsapp ?? null, igUsername),
    c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, role, client_id)
       VALUES (?, ?, ?, 'client', ?)`
    ).bind(userId, body.login_email.toLowerCase(), passwordHash, clientId),
    // Auto-create CRM lead linked to this client
    c.env.DB.prepare(
      `INSERT INTO crm_leads (id, name, company, email, phone, stage, notes)
       VALUES (?, ?, ?, ?, ?, 'fechado', ?)`
    ).bind(
      crmId,
      body.name,
      body.company_name,
      body.email,
      body.phone ?? null,
      `Cliente cadastrado automaticamente. Segmento: ${body.segment ?? '—'}`
    ),
  ])

  return created({ clientId, userId, crmId, message: 'Cliente criado com sucesso' })
}

export async function updateClient(c: Context<{ Bindings: Env }>) {
  const p = c.req.param() as any
  const id = p.id ?? p.clientId
  const body = await c.req.json<{
    name?: string; company_name?: string; email?: string
    phone?: string; segment?: string; accent_color?: string
    instagram_username?: string; whatsapp?: string
  }>()

  const client = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first()
  if (!client) return notFound('Cliente')

  const igUsername = body.instagram_username !== undefined
    ? (body.instagram_username?.replace(/^@/, '').trim() || null)
    : undefined

  await c.env.DB.prepare(
    `UPDATE clients SET
      name = COALESCE(?, name),
      company_name = COALESCE(?, company_name),
      email = COALESCE(?, email),
      phone = COALESCE(?, phone),
      segment = COALESCE(?, segment),
      accent_color = COALESCE(?, accent_color),
      instagram_username = COALESCE(?, instagram_username),
      whatsapp = COALESCE(?, whatsapp),
      updated_at = datetime('now')
     WHERE id = ?`
  ).bind(
    body.name ?? null, body.company_name ?? null, body.email ?? null,
    body.phone ?? null, body.segment ?? null, body.accent_color ?? null,
    igUsername ?? null, body.whatsapp ?? null, id
  ).run()

  return ok({ message: 'Cliente atualizado com sucesso' })
}

export async function deleteClient(c: Context<{ Bindings: Env }>) {
  const p = c.req.param() as any
  const id = p.id ?? p.clientId
  const hard = c.req.query('hard') === '1'
  const client = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(id).first()
  if (!client) return notFound('Cliente')

  if (hard) {
    // Hard delete — remove completely from all tables
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM daily_metrics WHERE cycle_id IN (SELECT id FROM cycles WHERE client_id=?)').bind(id),
      c.env.DB.prepare('DELETE FROM cycles WHERE client_id=?').bind(id),
      c.env.DB.prepare('DELETE FROM users WHERE client_id=?').bind(id),
      c.env.DB.prepare('DELETE FROM tasks WHERE client_id=?').bind(id),
      c.env.DB.prepare('DELETE FROM projects WHERE client_id=?').bind(id),
      c.env.DB.prepare('DELETE FROM message_log WHERE client_id=?').bind(id),
      c.env.DB.prepare('DELETE FROM clients WHERE id=?').bind(id),
    ])
    return ok({ message: 'Cliente removido permanentemente' })
  }

  // Soft delete
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE clients SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').bind(id),
    c.env.DB.prepare('UPDATE users SET is_active = 0 WHERE client_id = ?').bind(id),
  ])

  return ok({ message: 'Cliente desativado com sucesso' })
}

// POST /api/admin/clients/:clientId/send-message
export async function sendClientMessage(c: Context<{ Bindings: Env }>) {
  const { clientId } = c.req.param()
  const body = await c.req.json<{ channel: 'whatsapp' | 'email'; message: string; subject?: string }>()

  const client = await c.env.DB.prepare(
    'SELECT id, name, company_name, email, whatsapp FROM clients WHERE id=? AND is_active=1'
  ).bind(clientId).first<{ id: string; name: string; company_name: string; email: string; whatsapp: string | null }>()
  if (!client) return notFound('Cliente')

  const logId = generateId()
  let result: any = { logged: true }

  if (body.channel === 'whatsapp') {
    const phone = client.whatsapp?.replace(/\D/g, '')
    if (!phone) return err('Cliente não tem WhatsApp cadastrado')

    if (c.env.ZAPI_INSTANCE && c.env.ZAPI_TOKEN) {
      // Send via Z-API
      await fetch(
        `https://api.z-api.io/instances/${c.env.ZAPI_INSTANCE}/token/${c.env.ZAPI_TOKEN}/send-text`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: `55${phone}`, message: body.message }),
        }
      )
      result = { sent: true, via: 'zapi' }
    } else {
      // Return wa.me link
      result = {
        sent: false,
        link: `https://wa.me/55${phone}?text=${encodeURIComponent(body.message)}`,
        via: 'link',
      }
    }
  } else {
    // Email — return mailto link (no SMTP configured by default)
    result = {
      sent: false,
      link: `mailto:${client.email}?subject=${encodeURIComponent(body.subject ?? 'Mensagem da agência')}&body=${encodeURIComponent(body.message)}`,
      via: 'link',
    }
  }

  // Log the message
  await c.env.DB.prepare(
    `INSERT INTO message_log (id, client_id, channel, message) VALUES (?, ?, ?, ?)`
  ).bind(logId, clientId, body.channel, body.message).run()

  return ok({ ...result, logId })
}

// GET /api/admin/clients/:clientId/messages
export async function getClientMessages(c: Context<{ Bindings: Env }>) {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM message_log WHERE client_id=? ORDER BY created_at DESC LIMIT 50`
  ).bind(c.req.param('clientId')).all()
  return ok(rows.results)
}

export async function resetClientPassword(c: Context<{ Bindings: Env }>) {
  const { id, clientId } = c.req.param()
  const resolvedId = id ?? clientId
  const body = await c.req.json<{ new_password: string }>()

  if (!body.new_password || body.new_password.length < 8) {
    return err('Nova senha deve ter pelo menos 8 caracteres')
  }

  const user = await c.env.DB.prepare(
    'SELECT id FROM users WHERE client_id = ? AND role = \'client\''
  ).bind(resolvedId).first<{ id: string }>()
  if (!user) return notFound('Usuário do cliente')

  const newHash = await hash(body.new_password, 10)
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(newHash, user.id).run()

  return ok({ message: 'Senha redefinida com sucesso' })
}
