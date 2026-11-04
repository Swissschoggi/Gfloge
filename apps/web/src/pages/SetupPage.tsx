import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import type { MePayload } from '@gfloge/shared'
import { Brand } from '../components/Brand'

export function SetupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<{ initialized: boolean }>('/api/v1/setup/status'),
  })
  const setup = useMutation({
    mutationFn: (input: { email: string; password: string; displayName: string }) =>
      api.post<{ me: MePayload }>('/api/v1/setup', input),
    onSuccess: (res) => {
      queryClient.setQueryData(['me'], { me: res.me })
      navigate('/', { replace: true })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Setup failed. Retry.'),
  })

  if (status.data?.initialized) return <Navigate to="/signin" replace />

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setup.mutate({ email, password, displayName })
  }

  return (
    <div className="authlayout">
      <form className="authcard" onSubmit={submit} aria-labelledby="setup-title">
        <Brand asLink={false} />
        <h1 id="setup-title">
          Set up your Gfloge instance
        </h1>
        <p className="form-note">This runs once: the first account becomes the instance administrator.</p>
        <div className="field">
          <label htmlFor="su-name">Your name</label>
          <input id="su-name" className="input" required autoComplete="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="su-email">Email address</label>
          <input id="su-email" className="input" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="su-password">Password</label>
          <input id="su-password" className="input" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="hint">At least 10 characters.</p>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn" type="submit" disabled={setup.isPending}>
          {setup.isPending ? 'Creating…' : 'Create administrator account'}
        </button>
      </form>
    </div>
  )
}
