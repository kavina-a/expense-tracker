import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Login from './pages/Login'

// Shows the app only while the session cookie is valid. The cookie is httpOnly,
// so the page can't read it; it just asks the server.
export default function AuthGate({ children }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState('checking') // checking | in | out

  const check = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me')
      setState(res.ok ? 'in' : 'out')
    } catch {
      setState('out')
    }
  }, [])

  useEffect(() => {
    check()
    // Earlier versions cached API responses (your transactions) on the device.
    if ('caches' in window) caches.delete('api-cache').catch(() => {})
    const onAuthRequired = () => {
      queryClient.clear()
      setState('out')
    }
    window.addEventListener('auth-required', onAuthRequired)
    return () => window.removeEventListener('auth-required', onAuthRequired)
  }, [check, queryClient])

  if (state === 'checking') return <div className="min-h-screen bg-cream" />
  if (state === 'out') {
    return <Login onSuccess={() => { queryClient.clear(); setState('in') }} />
  }
  return children
}
