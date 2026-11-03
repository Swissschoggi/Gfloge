// Auth gate: resolves the session; redirects unauthenticated users to
// /signin with a return path, per deep-link-auth rules in UX doc §1.2.
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import type { MePayload } from '@gfloge/shared'

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me', { credentials: 'same-origin' })
      if (res.status === 401) return { me: null }
      if (!res.ok) throw new Error('me failed')
      return (await res.json()) as { me: MePayload }
    },
    staleTime: 30_000,
  })
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe()
  const location = useLocation()
  if (me.isLoading) {
    return (
      <div className="authlayout">
        <p className="form-note">Loading your session…</p>
      </div>
    )
  }
  if (!me.data?.me) {
    void me.refetch
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/signin?next=${next}`} replace />
  }
  return <>{children}</>
}
