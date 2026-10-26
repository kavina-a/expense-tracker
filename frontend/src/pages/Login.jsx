import { useState } from 'react'
import { Lock } from 'lucide-react'

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) {
        setPassword('')
        onSuccess()
        return
      }
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Could not sign in')
    } catch {
      setError('Could not reach the server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream flex items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-hero border-2 border-ink shadow-brutal p-6">
        <div className="flex items-center gap-3 mb-6">
          <img src="/icon-192.png" alt="" className="w-10 h-10 rounded-item object-cover border-2 border-ink" />
          <div>
            <h1 className="font-bold text-ink">Money Tracker</h1>
            <p className="text-[11px] font-bold text-warm-600 tracking-wide">SIGN IN</p>
          </div>
        </div>

        <label htmlFor="password" className="block text-[11px] font-bold text-warm-600 tracking-wide mb-1.5">PASSWORD</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2.5 rounded-item border-2 border-ink text-sm text-ink focus:outline-none focus:shadow-brutal-xs"
        />

        {error && <p role="alert" className="text-sm font-bold text-terra mt-3">{error}</p>}

        <button
          type="submit"
          disabled={!password || busy}
          className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-item bg-terra text-white text-sm font-bold border-2 border-ink shadow-brutal-sm disabled:opacity-50"
        >
          <Lock size={16} /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
