export function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

// Alias usado pelos handlers de Instagram/Calendário/Tendências
export const newId = generateId
