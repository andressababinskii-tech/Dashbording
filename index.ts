import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { Env } from './auth.middleware'
import { authMiddleware, adminOnly } from './auth.middleware'
import { login, refresh, logout, changePassword } from './auth.handler'
import { listClients, getClient, createClient, updateClient, deleteClient, resetClientPassword, sendClientMessage, getClientMessages } from './client.handler'
import { listCycles, getCycle, createCycle, updateCycle, deleteCycle } from './cycle.handler'
import { listMetrics, upsertMetric, addBudgetAdjustment } from './metrics.handler'
import { getMyDashboard, getMyCycles, getMyCycleDetail } from './dashboard.handler'
import { uploadLogo, serveLogo } from './upload.handler'
import { getWhatsAppLink, sendAlert, updateWhatsApp } from './whatsapp.handler'
import { listInstagramAccounts, getInstagramAccount, upsertInstagramAccount, toggleInstagramStatus, deleteInstagramAccount } from './instagram.handler'
import { updateInstagramAccounts, updateTrends } from './cron.handler'
import { getTrends, syncTrends, syncTrendsNow, searchTrends } from './trends.handler'
import { listCalendar, createCalendarEntry, updateCalendarEntry, deleteCalendarEntry, syncCalendar, syncCalendarFromNotion } from './calendar.handler'
import { getFinanceiro, createEntry, updateEntry, deleteEntry } from './financeiro.handler'
import { listTasks, createTask, updateTask, deleteTask } from './tasks.handler'
import { listLeads, createLead, updateLead, deleteLead, listInteractions, addInteraction } from './crm.handler'
import { listMargens, upsertMargem } from './margem.handler'
import { listProjects, createProject, updateProject, deleteProject, listProjectTasks, createProjectTask, updateProjectTask, deleteProjectTask } from './projetos.handler'
import { getManyhatInfo, listSubscribers, getSubscriber, sendManyChat, listFlows, triggerFlow, addTag, listTags, listMessages, syncSubscribersToCRM } from './conversas.handler'
import { getWebhookInfo, receiveManyChat, listWebhookEvents } from './webhook.handler'
import { getIntegracoes, saveIntegracao, testIntegracao } from './integracoes.handler'
import { listDocuments, createDocument, updateDocument, deleteDocument } from './documents.handler'
import { listMeetings, createMeeting, deleteMeeting } from './meetings.handler'

const app = new Hono<{ Bindings: Env }>()

// CORS
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: c.env.FRONTEND_URL ?? '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
  return corsMiddleware(c, next)
})

// ============================================================
// Rotas públicas (sem autenticação)
// ============================================================
app.post('/api/auth/login', login)
app.post('/api/auth/refresh', refresh)
app.get('/api/logos/:filename', serveLogo)   // logos servidas como imagem

// Webhook ManyChat (público — ManyChat chama esta URL)
app.post('/api/webhook/manychat', receiveManyChat)

// ============================================================
// Rotas autenticadas (todos os papéis)
// ============================================================
app.use('/api/*', authMiddleware)

app.post('/api/auth/logout', logout)
app.post('/api/auth/change-password', changePassword)

// Dashboard do cliente (acesso do cliente)
app.get('/api/dashboard/me', getMyDashboard)
app.get('/api/dashboard/me/cycles', getMyCycles)
app.get('/api/dashboard/me/cycles/:cycleId', getMyCycleDetail)

// ============================================================
// Rotas admin
// ============================================================
app.use('/api/admin/*', adminOnly)

// Clientes
app.get('/api/admin/clients', listClients)
app.post('/api/admin/clients', createClient)
app.get('/api/admin/clients/:clientId', getClient)
app.put('/api/admin/clients/:clientId', updateClient)
app.delete('/api/admin/clients/:clientId', deleteClient)
app.post('/api/admin/clients/:clientId/reset-password', resetClientPassword)
app.post('/api/admin/clients/:clientId/send-message', sendClientMessage)
app.get('/api/admin/clients/:clientId/messages', getClientMessages)

// Documentos do cliente
app.get('/api/admin/clients/:clientId/documents', listDocuments)
app.post('/api/admin/clients/:clientId/documents', createDocument)
app.put('/api/admin/clients/:clientId/documents/:docId', updateDocument)
app.delete('/api/admin/clients/:clientId/documents/:docId', deleteDocument)

// Reuniões do cliente
app.get('/api/admin/clients/:clientId/meetings', listMeetings)
app.post('/api/admin/clients/:clientId/meetings', createMeeting)
app.delete('/api/admin/clients/:clientId/meetings/:meetingId', deleteMeeting)

// Ciclos
app.get('/api/admin/clients/:clientId/cycles', listCycles)
app.post('/api/admin/clients/:clientId/cycles', createCycle)
app.get('/api/admin/cycles/:cycleId', getCycle)
app.put('/api/admin/cycles/:cycleId', updateCycle)
app.delete('/api/admin/cycles/:cycleId', deleteCycle)

// Métricas
app.get('/api/admin/cycles/:cycleId/metrics', listMetrics)
app.post('/api/admin/cycles/:cycleId/metrics', upsertMetric)
app.post('/api/admin/cycles/:cycleId/budget-adjustment', addBudgetAdjustment)

// Logo (upload + serve público)
app.post('/api/admin/clients/:clientId/logo', uploadLogo)

// WhatsApp
app.get('/api/admin/clients/:clientId/whatsapp-link', getWhatsAppLink)
app.post('/api/admin/clients/:clientId/whatsapp-alert', sendAlert)
app.put('/api/admin/clients/:clientId/whatsapp', updateWhatsApp)

// Instagram
app.get('/api/admin/instagram', listInstagramAccounts)
app.get('/api/admin/instagram/:username', getInstagramAccount)
app.put('/api/admin/instagram/:username', upsertInstagramAccount)
app.patch('/api/admin/instagram/:username/status', toggleInstagramStatus)
app.delete('/api/admin/instagram/:username', deleteInstagramAccount)

// Tendências
app.get('/api/admin/trends', getTrends)
app.post('/api/admin/trends/sync', syncTrends)
app.post('/api/admin/trends/sync-now', syncTrendsNow)
app.post('/api/admin/trends/search', searchTrends)

// Calendário editorial
app.get('/api/admin/calendar', listCalendar)
app.post('/api/admin/calendar', createCalendarEntry)
app.patch('/api/admin/calendar/:id', updateCalendarEntry)
app.delete('/api/admin/calendar/:id', deleteCalendarEntry)
app.post('/api/admin/calendar/sync', syncCalendar)
app.post('/api/admin/calendar/sync-notion', syncCalendarFromNotion)

// ── Financeiro ───────────────────────────────────────────────────────────────
app.get('/api/admin/financeiro', getFinanceiro)
app.post('/api/admin/financeiro', createEntry)
app.put('/api/admin/financeiro/:id', updateEntry)
app.delete('/api/admin/financeiro/:id', deleteEntry)

// ── Tarefas ───────────────────────────────────────────────────────────────────
app.get('/api/admin/tasks', listTasks)
app.post('/api/admin/tasks', createTask)
app.patch('/api/admin/tasks/:id', updateTask)
app.delete('/api/admin/tasks/:id', deleteTask)

// ── CRM Pipeline ──────────────────────────────────────────────────────────────
app.get('/api/admin/crm', listLeads)
app.post('/api/admin/crm', createLead)
app.put('/api/admin/crm/:id', updateLead)
app.delete('/api/admin/crm/:id', deleteLead)
app.get('/api/admin/crm/:id/interactions', listInteractions)
app.post('/api/admin/crm/:id/interactions', addInteraction)

// ── Margem de Lucro ───────────────────────────────────────────────────────────
app.get('/api/admin/margem', listMargens)
app.post('/api/admin/margem', upsertMargem)

// ── Projetos ──────────────────────────────────────────────────────────────────
app.get('/api/admin/projetos', listProjects)
app.post('/api/admin/projetos', createProject)
app.put('/api/admin/projetos/:id', updateProject)
app.delete('/api/admin/projetos/:id', deleteProject)
app.get('/api/admin/projetos/:id/tasks', listProjectTasks)
app.post('/api/admin/projetos/:id/tasks', createProjectTask)
app.patch('/api/admin/projetos/tasks/:taskId', updateProjectTask)
app.delete('/api/admin/projetos/tasks/:taskId', deleteProjectTask)

// ── Integrações (Meta / Notion / ManyChat tokens) ────────────────────────────
app.get('/api/admin/integracoes', getIntegracoes)
app.put('/api/admin/integracoes/:service', saveIntegracao)
app.post('/api/admin/integracoes/:service/test', testIntegracao)

// ── Conversas (ManyChat) ──────────────────────────────────────────────────────
app.get('/api/admin/conversas/info',           getManyhatInfo)
app.get('/api/admin/conversas/subscribers',    listSubscribers)
app.get('/api/admin/conversas/subscribers/:id', getSubscriber)
app.post('/api/admin/conversas/send',          sendManyChat)
app.get('/api/admin/conversas/flows',          listFlows)
app.post('/api/admin/conversas/trigger',       triggerFlow)
app.get('/api/admin/conversas/tags',           listTags)
app.post('/api/admin/conversas/tag',           addTag)
app.get('/api/admin/conversas/messages',       listMessages)
app.post('/api/admin/conversas/sync-crm',      syncSubscribersToCRM)
app.get('/api/admin/conversas/webhook-info',   getWebhookInfo)
app.get('/api/admin/conversas/events',         listWebhookEvents)

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// 404
app.notFound((c) => c.json({ success: false, error: 'Rota não encontrada' }, 404))

export default {
  fetch: app.fetch.bind(app),

  // Cron: toda segunda às 12h UTC (9h BRT)
  async scheduled(_event: ScheduledEvent, env: Env) {
    await Promise.allSettled([
      updateInstagramAccounts(env),
      updateTrends(env),
    ])
  },
}
