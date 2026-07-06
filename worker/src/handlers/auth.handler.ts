import { Context } from 'hono'
import { compare, hash } from 'bcryptjs'
import { signAccessToken, signRefreshToken, verifyToken } from '../utils/jwt'
import { ok, err, unauthorized } from '../utils/response'
import { generateId } from '../utils/id'
import { Env } from '../middleware/auth.middleware'

export async function login(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ email: string; password: string }>()

  if (!body.email || !body.password) {
    return err('Email e senha são obrigatórios')
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, password_hash, role, client_id FROM users WHERE email = ? AND is_active = 1'
  ).bind(body.email.toLowerCase().trim()).first<{
    id: string; email: string; password_hash: string; role: string; client_id: string | null
  }>()

  if (!user) {
    return err('Email ou senha inválidos', 401)
  }

  const valid = await compare(body.password, user.password_hash)
  if (!valid) {
    return err('Email ou senha inválidos', 401)
  }

  const tokenId = generateId()
  const payload = {
    sub: user.id,
    role: user.role as 'admin' | 'client',
    clientId: user.client_id,
    tokenId,
  }

  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(payload, c.env.JWT_SECRET),
    signRefreshToken(payload, c.env.JWT_SECRET),
  ])

  // Armazena sessão no KV com TTL de 7 dias
  await c.env.SESSIONS.put(
    `session:${user.id}:${tokenId}`,
    JSON.stringify({ userId: user.id, role: user.role }),
    { expirationTtl: 604800 }
  )

  return ok({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, role: user.role, clientId: user.client_id },
  })
}

export async function refresh(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ refreshToken: string }>()
  if (!body.refreshToken) return err('Token de refresh obrigatório')

  try {
    const payload = await verifyToken(body.refreshToken, c.env.JWT_SECRET)
    const sessionKey = `session:${payload.sub}:${payload.tokenId}`
    const session = await c.env.SESSIONS.get(sessionKey)
    if (!session) return unauthorized()

    // Invalida token antigo e gera novo
    await c.env.SESSIONS.delete(sessionKey)
    const newTokenId = generateId()
    const newPayload = { ...payload, tokenId: newTokenId }
    const accessToken = await signAccessToken(newPayload, c.env.JWT_SECRET)

    await c.env.SESSIONS.put(
      `session:${payload.sub}:${newTokenId}`,
      JSON.stringify({ userId: payload.sub, role: payload.role }),
      { expirationTtl: 604800 }
    )

    return ok({ accessToken })
  } catch {
    return unauthorized()
  }
}

export async function logout(c: Context<{ Bindings: Env }>) {
  const user = c.get('user')
  await c.env.SESSIONS.delete(`session:${user.sub}:${user.tokenId}`)
  return ok({ message: 'Logout realizado com sucesso' })
}

export async function changePassword(c: Context<{ Bindings: Env }>) {
  const user = c.get('user')
  const body = await c.req.json<{ currentPassword: string; newPassword: string }>()

  if (!body.currentPassword || !body.newPassword) {
    return err('Senha atual e nova senha são obrigatórias')
  }
  if (body.newPassword.length < 8) {
    return err('Nova senha deve ter pelo menos 8 caracteres')
  }

  const dbUser = await c.env.DB.prepare(
    'SELECT password_hash FROM users WHERE id = ?'
  ).bind(user.sub).first<{ password_hash: string }>()

  if (!dbUser) return err('Usuário não encontrado', 404)

  const valid = await compare(body.currentPassword, dbUser.password_hash)
  if (!valid) return err('Senha atual incorreta', 401)

  const newHash = await hash(body.newPassword, 10)
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(newHash, user.sub).run()

  return ok({ message: 'Senha alterada com sucesso' })
}
