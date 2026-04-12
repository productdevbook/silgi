import { useCallback, useRef, useState } from 'react'

const FEEDBACK_DURATION_MS = 2000

export function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopiedId(null), FEEDBACK_DURATION_MS)
    })
  }, [])

  return { copiedId, copy } as const
}
