export function mobileHomeOrderKey(userId: string): string {
  return `drhappy-mobile-home-order:${encodeURIComponent(userId)}`
}

export function parseMobileHomeOrder(value: string | null): string[] {
  if (value === null) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || !parsed.every((key): key is string => typeof key === 'string' && key.length > 0)) {
    throw new Error('El orden guardado del menú no es válido.')
  }
  return [...new Set(parsed)]
}

export function visibleHomeOrder(saved: string[], available: string[]): string[] {
  const availableSet = new Set(available)
  return [...new Set([...saved.filter((key) => availableSet.has(key)), ...available])]
}

export function reorderHomeActions(saved: string[], available: string[], active: string, over: string): string[] {
  const visible = visibleHomeOrder(saved, available)
  const from = visible.indexOf(active)
  const to = visible.indexOf(over)
  if (from < 0 || to < 0 || from === to) return saved
  visible.splice(to, 0, ...visible.splice(from, 1))
  const availableSet = new Set(available)
  let position = 0
  const result = [...new Set([...saved, ...available])].map((key) =>
    availableSet.has(key) ? visible[position++] : key,
  )
  return result
}
