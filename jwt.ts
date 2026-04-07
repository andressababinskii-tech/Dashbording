import { SignJWT, jwtVerify } from 'jose'

export interface JwtPayload {
  sub: string       // userId
  role: 'admin' | 'client'
  clientId: string | null
  tokenId: string
}

function getSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signAccessToken(payload: JwtPayload, secret: string): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(getSecret(secret))
}

export async function signRefreshToken(payload: JwtPayload, secret: string): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(getSecret(secret))
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret(secret))
  return payload as unknown as JwtPayload
}
