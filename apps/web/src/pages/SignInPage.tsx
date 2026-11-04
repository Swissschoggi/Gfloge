import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { MePayload } from '@gfloge/shared'
import { Brand } from '../components/Brand'

export function SignInPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setup = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<{ initialized: boolean; seededDemo: boolean }>('/api/v1/setup/status'),
  })
  if (setup.data && !setup.data.initialized) return <Navigate to="/setup" replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ me: MePayload }>('/api/v1/auth/login', { email, password })
      queryClient.setQueryData(['me'], { me: res.me })
      navigate(next, { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign in failed. Retry.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="authlayout">
      <form className="authcard" onSubmit={(e) => void submit(e)} aria-labelledby="signin-title">
        <Brand asLink={false} />
        <div>
          <h1 id="signin-title">Welcome back</h1>
          <p className="form-note">Sign in to your flight log.</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {setup.data?.seededDemo ? (
          <p className="demo-hint">Demo mode: marta@gfloge.demo / flighty-demo-1 · admin: admin@gfloge.demo / demo-admin-1</p>
        ) : null}
      </form>
    </div>
  )
}
