export function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export function fmtMs(n: number): string {
  if (n < 1) return `${n.toFixed(2)}ms`
  if (n < 1000) return `${n.toFixed(1)}ms`
  return `${(n / 1000).toFixed(1)}s`
}

export function fmtUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

export function fmtTime(timestamp: number): string {
  const d = new Date(timestamp)
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.toLocaleTimeString()}.${ms}`
}
