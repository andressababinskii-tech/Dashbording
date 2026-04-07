import { Context } from 'hono'
import { Env } from '../middleware/auth.middleware'
import { jsonOk, jsonErr } from '../utils/response'
import { newId } from '../utils/id'

type C = Context<{ Bindings: Env }>

// GET /api/admin/clients/:clientId/meetings
export async function listMeetings(c: C) {
  const clientId = c.req.param('clientId')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM client_meetings WHERE client_id = ? ORDER BY meeting_date ASC`
  ).bind(clientId).all()
  return jsonOk(c, results)
}

// POST /api/admin/clients/:clientId/meetings
export async function createMeeting(c: C) {
  const clientId = c.req.param('clientId')
  const body = await c.req.json<{ title: string; meeting_date: string; notes?: string }>()
  if (!body.title || !body.meeting_date) return jsonErr(c, 'title e meeting_date são obrigatórios', 400)

  // Get client info for calendar and CRM sync
  const client = await c.env.DB.prepare(
    `SELECT id, company_name, email FROM clients WHERE id = ?`
  ).bind(clientId).first<{ id: string; company_name: string; email: string }>()
  if (!client) return jsonErr(c, 'Cliente não encontrado', 404)

  const meetingId  = newId()
  const calEntryId = newId()

  // Create meeting record
  await c.env.DB.prepare(
    `INSERT INTO client_meetings (id, client_id, title, meeting_date, notes, calendar_entry_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(meetingId, clientId, body.title, body.meeting_date, body.notes ?? null, calEntryId).run()

  // Create calendar entry linked to this meeting
  const dayOfWeek = getDayPT(body.meeting_date)
  await c.env.DB.prepare(
    `INSERT INTO calendar_entries (id, username, scheduled_date, day_of_week, format, theme, status, entry_type, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    calEntryId,
    client.company_name,
    body.meeting_date,
    dayOfWeek,
    'Reunião',
    body.title,
    'Agendado',
    'meeting',
    clientId
  ).run()

  // Auto-sync CRM: find the lead for this client and register interaction + move to reuniao_mensal if applicable
  const lead = await c.env.DB.prepare(
    `SELECT id, stage FROM crm_leads
     WHERE company = ? OR email = ?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(client.company_name, client.email).first<{ id: string; stage: string }>()

  if (lead) {
    const interactionId = newId()
    await c.env.DB.prepare(
      `INSERT INTO crm_interactions (id, lead_id, type, content) VALUES (?, ?, ?, ?)`
    ).bind(interactionId, lead.id, 'meeting', `Reunião agendada: ${body.title} — ${formatDateBR(body.meeting_date)}`).run()

    // Move to reuniao_mensal stage when client already closed (fechado)
    if (lead.stage === 'fechado') {
      await c.env.DB.prepare(
        `UPDATE crm_leads SET stage = 'reuniao_mensal', updated_at = datetime('now') WHERE id = ?`
      ).bind(lead.id).run()
    }
  }

  return jsonOk(c, { id: meetingId, calendar_entry_id: calEntryId })
}

// DELETE /api/admin/clients/:clientId/meetings/:meetingId
export async function deleteMeeting(c: C) {
  const meetingId = c.req.param('meetingId')

  // Get calendar_entry_id before deleting
  const meeting = await c.env.DB.prepare(
    `SELECT calendar_entry_id FROM client_meetings WHERE id = ?`
  ).bind(meetingId).first<{ calendar_entry_id: string | null }>()

  await c.env.DB.prepare(`DELETE FROM client_meetings WHERE id = ?`).bind(meetingId).run()

  if (meeting?.calendar_entry_id) {
    await c.env.DB.prepare(`DELETE FROM calendar_entries WHERE id = ?`).bind(meeting.calendar_entry_id).run()
  }

  return jsonOk(c, { deleted: true })
}

function getDayPT(dateStr: string): string {
  const days = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
  const d = new Date(dateStr + 'T12:00:00')
  return days[d.getDay()]
}

function formatDateBR(dateStr: string): string {
  const [y, m, d] = dateStr.split('-')
  return `${d}/${m}/${y}`
}
