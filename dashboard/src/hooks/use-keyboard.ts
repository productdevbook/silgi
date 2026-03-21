import { useEffect } from 'react'

interface KeyboardActions {
  navigate: (page: string) => void
  toggleRefresh: () => void
}

export function useKeyboard({ navigate, toggleRefresh }: KeyboardActions) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key) {
        case '1':
          navigate('overview')
          break
        case '2':
          navigate('requests')
          break
        case '3':
          navigate('errors')
          break
        case 'r':
          toggleRefresh()
          break
        case '/':
          e.preventDefault()
          // Focus the first search input on the page
          const input = document.querySelector<HTMLInputElement>('input[type="search"]')
          input?.focus()
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, toggleRefresh])
}
