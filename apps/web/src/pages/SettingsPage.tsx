import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { UserPreferences } from '@gfloge/shared'
import { useMe } from '../components/RequireAuth'
import { ProviderSettings } from '../components/ProviderSettings'

const TABS = [
  { key: 'profile', label: 'Profile' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'trips', label: 'Trips' },
  { key: 'users', label: 'Users' },
  { key: 'providers', label: 'Data sources' },
  { key: 'instance', label: 'Instance' },
  { key: 'historical', label: 'Historical data' },
  { key: 'reference', label: 'Reference data' },
] as const

export function SettingsPage() {

  const [params] = useSearchParams()
  const requested = params.get('tab') ?? 'profile'
  const me = useMe()
  const isAdmin = me.data?.me?.role === 'admin'
  const visible = TABS.filter((tab) => ['profile', 'calendar', 'notifications', 'trips', 'historical', 'reference'].includes(tab.key) || isAdmin)
  const active = visible.some((tab) => tab.key === requested) ? requested : 'profile'
  return (
    <div className="page settings-page">

      <header className="settings-heading">
        <div><p className="eyebrow">Account / instance controls</p><h1>Settings</h1></div>
        <p>Personal display preferences and instance administration.</p>
      </header>
      <div className="settings-workspace">
      <nav className="settings-index" aria-label="Settings sections">
        {visible.map((tab) => <Link key={tab.key} to={`?tab=${tab.key}`} aria-current={active === tab.key ? 'page' : undefined}><span>{tab.label}</span><span aria-hidden="true">→</span></Link>)}
      </nav>
      <section className="settings-content" aria-labelledby="settings-section-title">
        <header><h2 id="settings-section-title">{TABS.find((tab) => tab.key === active)?.label ?? 'Settings section'}</h2></header>
      {active === 'profile' && <ProfileSettings />}
      {active === 'calendar' && <CalendarSettings />}
      {active === 'notifications' && <NotificationSettings />}
      {active === 'trips' && <div className="data-panel"><h2 className="data-panel__title">Trips</h2><p>Your itineraries are stored separately from your logbook flights.</p><Link className="btn" to="/trips">Open trips</Link></div>}
      {active === 'users' && isAdmin && <UserSettings />}
      {active === 'providers' && isAdmin && <ProviderSettings />}
      {active === 'instance' && isAdmin && <InstanceSettings />}
      {active === 'historical' && <HistoricalData />}
      {active === 'reference' && <ReferenceData />}
      </section>
      </div>
    </div>
  )
}

function ProfileSettings() {
  const queryClient = useQueryClient()
  const prefs = useQuery({ queryKey: ['preferences'], queryFn: () => api.get<{preferences: UserPreferences & {email:string;displayName:string}}>('/api/v1/me/preferences') })
  const [message,setMessage] = useState<string|null>(null)
  const [error,setError] = useState<string|null>(null)
  const [name,setName] = useState('')
  const [units,setUnits] = useState<'km'|'mi'>('km')
  const [timezoneDisplay,setTimezoneDisplay] = useState<'airport'|'local'|'utc'>('airport')
  const [themeOverride,setThemeOverride] = useState<'system'|'day'|'night'>('system')
  const [delays,setDelays] = useState(true)
  const [gates,setGates] = useState(true)
  const [cancellations,setCancellations] = useState(true)
  useEffect(()=>{
    const p=prefs.data?.preferences
    if(!p) return
    setName(p.displayName); setUnits(p.units); setTimezoneDisplay(p.timezoneDisplay); setThemeOverride(p.themeOverride)
    setDelays(p.notificationPrefs.delays); setGates(p.notificationPrefs.gates); setCancellations(p.notificationPrefs.cancellations)
  },[prefs.data])
  const save=useMutation({mutationFn:()=>api.patch('/api/v1/me/preferences',{displayName:name,units,timezoneDisplay,themeOverride,notificationPrefs:{delays,gates,cancellations}}),onSuccess:()=>{setMessage('Preferences saved.');setError(null);localStorage.setItem('gfloge-timezone-display',timezoneDisplay);localStorage.setItem('gfloge-units',units);if(themeOverride!=='system'){document.documentElement.dataset.theme=themeOverride;localStorage.setItem('gfloge-theme',themeOverride)}else{localStorage.removeItem('gfloge-theme')}void queryClient.invalidateQueries({queryKey:['preferences']})},onError:(e)=>setError((e as Error).message)})
  const password=useMutation({mutationFn:(v:{currentPassword:string;newPassword:string})=>api.post<{signedOut:boolean}>('/api/v1/me/password',v),onSuccess:()=>{setMessage('Password changed. Sign in again with the new password.');void api.post('/api/v1/auth/logout').catch(()=>{});setTimeout(()=>window.location.assign('/signin'),500)},onError:(e)=>setError((e as Error).message)})
  const deleteAccount=useMutation({mutationFn:(pw:string)=>api.delete('/api/v1/me',{password:pw}),onSuccess:()=>window.location.assign('/signin'),onError:(e)=>setError((e as Error).message)})
  const [currentPassword,setCurrentPassword]=useState(''); const [newPassword,setNewPassword]=useState('')
  if(prefs.isPending) return <div className="data-panel"><p>Loading preferences…</p></div>
  if(prefs.isError) return <div role="alert" className="form-error">Could not load preferences: {(prefs.error as Error).message}</div>
  async function changePassword(e:FormEvent){e.preventDefault();setError(null);password.mutate({currentPassword,newPassword})}
  return <div className="settings-stack">
    <form className="data-panel" onSubmit={(e)=>{e.preventDefault();save.mutate()}}>
      <h2 className="data-panel__title">Profile and display</h2>
      <div className="field"><label htmlFor="pref-name">Display name</label><input id="pref-name" className="input" value={name} onChange={e=>setName(e.target.value)} required maxLength={80}/></div>
      <div className="field"><label htmlFor="pref-email">Email</label><input id="pref-email" className="input" value={prefs.data.preferences.email} readOnly /></div>
      <div className="field"><label htmlFor="pref-units">Distance units</label><select id="pref-units" className="select" value={units} onChange={e=>setUnits(e.target.value as 'km'|'mi')}><option value="km">Kilometres</option><option value="mi">Miles</option></select></div>
      <div className="field"><label htmlFor="pref-zone">Time display</label><select id="pref-zone" className="select" value={timezoneDisplay} onChange={e=>setTimezoneDisplay(e.target.value as typeof timezoneDisplay)}><option value="airport">Airport local time</option><option value="local">My device time</option><option value="utc">UTC</option></select><p className="hint">Flight schedule values remain stored in UTC; this changes how they are displayed.</p></div>
      <div className="field"><label htmlFor="pref-theme">Theme</label><select id="pref-theme" className="select" value={themeOverride} onChange={e=>setThemeOverride(e.target.value as typeof themeOverride)}><option value="system">Follow system</option><option value="day">Chart Room</option><option value="night">Deep Chart</option></select></div>
      <fieldset className="field"><legend>Notification preferences (applies when a provider reports updates)</legend>{[['delays',delays,setDelays,'Delay changes'],['gates',gates,setGates,'Gate changes'],['cancellations',cancellations,setCancellations,'Cancellations and diversions']].map(([key,value,set,label])=><label key={String(key)} className="check-row"><input type="checkbox" checked={value as boolean} onChange={e=>(set as (v:boolean)=>void)(e.target.checked)}/>{label as string}</label>)}</fieldset>
      {message&&<p role="status" className="form-note">{message}</p>}{error&&<p role="alert" className="form-error">{error}</p>}
      <button className="btn" type="submit" disabled={save.isPending}>{save.isPending?'Saving…':'Save preferences'}</button>
    </form>
    <form className="data-panel" onSubmit={(e)=>void changePassword(e)}><h2 className="data-panel__title">Change password</h2><div className="field"><label htmlFor="cur-pw">Current password</label><input id="cur-pw" className="input" type="password" autoComplete="current-password" value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} required/></div><div className="field"><label htmlFor="new-pw">New password</label><input id="new-pw" className="input" type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={e=>setNewPassword(e.target.value)} required/><p className="hint">At least 10 characters.</p></div><button className="btn-outline" type="submit" disabled={password.isPending}>Change password</button></form>
    <DeleteAccount onDelete={(pw)=>deleteAccount.mutate(pw)} pending={deleteAccount.isPending}/>
  </div>
}


function CalendarSettings() {
  const [token, setToken] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generate = useMutation({
    mutationFn: () => api.post<{ token: string; url: string }>('/api/v1/calendar/feed'),
    onSuccess: (data) => { setToken(data.token); setMessage('Calendar feed created. Copy the URL now; it will not be shown again.'); setError(null) },
    onError: (e) => setError((e as Error).message),
  })
  const revoke = useMutation({
    mutationFn: () => api.delete('/api/v1/calendar/feed'),
    onSuccess: () => { setToken(null); setMessage('Calendar feed revoked.'); setError(null) },
    onError: (e) => setError((e as Error).message),
  })
  async function copy() {
    if (!token) return
    try { await navigator.clipboard.writeText(`${window.location.origin}/api/v1/calendar/${token}.ics`); setMessage('Copied to clipboard.') }
    catch { setError('Could not copy. Copy manually.') }
  }
  return (
    <div className="data-panel">
      <h2 className="data-panel__title">Calendar subscription</h2>
      <p className="form-note">Generate a private, subscribable .ics feed for upcoming flights. Anyone with the URL can access it. It exposes flight numbers, airports, times, status and trip names, but not booking references, seats or private notes.</p>
      <div className="actions-row">
        <button className="btn" type="button" disabled={generate.isPending} onClick={() => generate.mutate()}>
          {generate.isPending ? 'Generating…' : token ? 'Regenerate URL' : 'Generate URL'}
        </button>
        {token && <button className="btn-outline" type="button" onClick={() => void copy()}>Copy URL</button>}
        {token && <button className="btn-danger" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate()}>Revoke</button>}
      </div>
      {token && <p className="form-note" role="status">Feed URL: {window.location.origin}/api/v1/calendar/{token}.ics</p>}
      {message && <p role="status" className="form-note">{message}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
    </div>
  )
}


function NotificationSettings() {
  const [supported] = useState(() => 'serviceWorker' in navigator && 'PushManager' in window)
  const [permission, setPermission] = useState(() => (supported ? Notification.permission : 'unsupported'))
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const vapid = useQuery({ queryKey: ['vapid'], queryFn: () => api.get<{ publicKey: string }>('/api/v1/push/vapid-public-key'), enabled: supported })
  async function enable() {
    setError(null); setMessage(null)
    if (!supported) { setError('Push notifications are not supported in this browser.'); return }
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') { setError('Permission was not granted.'); return }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapid.data!.publicKey })
      const json = sub.toJSON()
      await api.post('/api/v1/push/subscriptions', { endpoint: json.endpoint, keys: json.keys, userAgent: navigator.userAgent })
      setMessage('This device is subscribed.')
    } catch (e) { setError((e as Error).message) }
  }
  async function disable() {
    setError(null); setMessage(null)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) { await api.delete('/api/v1/push/subscriptions', { endpoint: sub.endpoint }); await sub.unsubscribe() }
      setMessage('This device is unsubscribed.')
    } catch (e) { setError((e as Error).message) }
  }
  async function test() {
    setError(null); setMessage(null)
    try { const r = await api.post<{ sent: number }>('/api/v1/push/test'); setMessage(`Sent ${r.sent} test notification(s).`) }
    catch (e) { setError((e as Error).message) }
  }
  return (
    <div className="data-panel">
      <h2 className="data-panel__title">Notifications</h2>
      <p className="form-note">Opt in to web push notifications for flight changes. Permission is requested only when you enable.</p>
      {!supported && <p role="alert" className="form-error">Push notifications are not supported in this browser.</p>}
      {supported && <p className="form-note">Permission: {permission}</p>}
      <div className="actions-row">
        <button className="btn" type="button" disabled={!supported || permission === 'denied' || vapid.isPending} onClick={() => void enable()}>Enable on this device</button>
        <button className="btn-outline" type="button" disabled={!supported} onClick={() => void disable()}>Disable on this device</button>
        <button className="btn-outline" type="button" disabled={!supported || permission !== 'granted'} onClick={() => void test()}>Send test</button>
      </div>
      {permission === 'denied' && <p role="alert" className="form-error">Permission denied. Enable notifications in browser settings.</p>}
      {message && <p role="status" className="form-note">{message}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <p className="form-note">Anyone with access to this device can see notifications. Flight details in notifications are limited.</p>
    </div>
  )
}

function DeleteAccount({onDelete,pending}:{onDelete:(pw:string)=>void;pending:boolean}){const [password,setPassword]=useState('');const [open,setOpen]=useState(false);return <form className="data-panel" onSubmit={e=>{e.preventDefault();onDelete(password)}}><h2 className="data-panel__title">Privacy and account</h2><p className="form-note">Deleting your account permanently removes your personal logbook, notes, follows, and trips. The instance owner still has host-level database access.</p>{open?<><div className="field"><label htmlFor="delete-password">Confirm with your password</label><input id="delete-password" className="input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></div><div className="actions-row"><button className="btn-outline" type="button" onClick={()=>setOpen(false)}>Keep account</button><button className="btn-danger" type="submit" disabled={pending}>{pending?'Deleting…':'Delete my account'}</button></div></>:<button className="btn-danger" type="button" onClick={()=>setOpen(true)}>Delete account</button>}</form>}

function UserSettings(){const q=useQuery({queryKey:['admin-users'],queryFn:()=>api.get<{users:Array<{id:string;email:string;displayName:string;role:string;deactivatedAt:string|null;createdAt:string}>}>('/api/v1/admin/users')});const qc=useQueryClient();const[error,setError]=useState<string|null>(null);const[email,setEmail]=useState('');const[name,setName]=useState('');const[pw,setPw]=useState('');const[role,setRole]=useState<'user'|'admin'>('user');const create=useMutation({mutationFn:()=>api.post('/api/v1/admin/users',{email,displayName:name,password:pw,role}),onSuccess:()=>{setEmail('');setName('');setPw('');void qc.invalidateQueries({queryKey:['admin-users']})},onError:e=>setError((e as Error).message)});const update=useMutation({mutationFn:({id,deactivated}:{id:string;deactivated:boolean})=>api.patch(`/api/v1/admin/users/${id}`,{deactivated}),onSuccess:()=>void qc.invalidateQueries({queryKey:['admin-users']})});if(q.isPending)return <p>Loading users…</p>;if(q.isError)return <div role="alert" className="form-error">{(q.error as Error).message}</div>;return <div className="settings-stack"><form className="data-panel" onSubmit={e=>{e.preventDefault();setError(null);create.mutate()}}><h2 className="data-panel__title">Add user</h2><div className="field"><label htmlFor="user-name">Name</label><input id="user-name" className="input" required value={name} onChange={e=>setName(e.target.value)}/></div><div className="field"><label htmlFor="user-email">Email</label><input id="user-email" className="input" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></div><div className="field"><label htmlFor="user-pw">Temporary password</label><input id="user-pw" className="input" type="password" minLength={10} required value={pw} onChange={e=>setPw(e.target.value)}/></div><div className="field"><label htmlFor="user-role">Role</label><select id="user-role" className="select" value={role} onChange={e=>setRole(e.target.value as typeof role)}><option value="user">User</option><option value="admin">Admin</option></select></div>{error&&<p className="form-error" role="alert">{error}</p>}<button className="btn" type="submit" disabled={create.isPending}>Create user</button></form><div className="data-panel"><h2 className="data-panel__title">Instance users</h2><ul className="explore-list">{q.data.users.map(u=><li key={u.id} className="admin-user"><span><strong>{u.displayName}</strong><small>{u.email} · {u.role} · {u.deactivatedAt?'deactivated':'active'}</small></span><button className="btn-outline" type="button" onClick={()=>update.mutate({id:u.id,deactivated:!u.deactivatedAt})}>{u.deactivatedAt?'Reactivate':'Deactivate'}</button></li>)}</ul></div></div>}

// ProviderSettings is now imported from components/ProviderSettings.tsx

function HistoricalData() {
  const q = useQuery({
    queryKey: ['historical-datasets'],
    queryFn: () => api.get<{ datasets: Array<{ id: string; title: string; status: string; sizeBytes: number | null; dateStart: string; dateEnd: string; license: string; attribution: string; progressBytes: number; error: string | null; localPath: string | null }> }>('/api/v1/historical/datasets'),
    refetchInterval: (query) => {
      const data = query.state.data as { datasets: Array<{ status: string }> } | undefined
      const active = data?.datasets.some((d) => d.status === 'downloading' || d.status === 'verifying' || d.status === 'queued')
      return active ? 1500 : false
    },
  })
  const qc = useQueryClient()
  const install = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/historical/datasets/${id}/download`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['historical-datasets'] }), onError: () => void qc.invalidateQueries({ queryKey: ['historical-datasets'] }) })
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/v1/historical/datasets/${id}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['historical-datasets'] }) })
  if (q.isPending) return <div className="data-panel"><p>Loading dataset catalogue…</p></div>
  if (q.isError) return <div role="alert" className="form-error">Catalogue unavailable. {(q.error as Error).message}</div>
  return (
    <div className="settings-stack">
      <div className="data-panel">
        <h2 className="data-panel__title">Historical datasets</h2>
        <p className="form-note">Optional, large datasets stored outside the database. The normal application works without them. Install only the quarters you need.</p>
      </div>
      {q.data.datasets.map((dataset) => {
        const progress = dataset.sizeBytes ? Math.min(100, Math.round((dataset.progressBytes / dataset.sizeBytes) * 100)) : null
        const isBusy = dataset.status === 'queued' || dataset.status === 'downloading' || dataset.status === 'verifying'
        return (
          <div className="data-panel" key={dataset.id}>
            <h3 className="data-panel__title">{dataset.title}</h3>
            <p className="form-note">{dataset.dateStart} to {dataset.dateEnd} · {dataset.sizeBytes ? `${Math.round(dataset.sizeBytes / 1024 / 1024)} MB` : 'size unknown'} · {dataset.license}</p>
            <p className="attribution">{dataset.attribution}</p>
            {dataset.status === 'downloading' && (
              <p className="form-note" role="status">
                Downloading… {Math.round(dataset.progressBytes / 1024 / 1024)} MB of {dataset.sizeBytes ? Math.round(dataset.sizeBytes / 1024 / 1024) : '?'} MB
                {progress !== null ? ` (${progress}%)` : ' (progress unavailable)'}
              </p>
            )}
            {dataset.status === 'verifying' && <p className="form-note" role="status">Verifying checksum…</p>}
            {dataset.status === 'failed' && <p role="alert" className="form-error">Download failed: {dataset.error}</p>}
            {dataset.status === 'installed' && <p className="form-note" role="status">Installed at {dataset.localPath}</p>}
            {isBusy && (
              <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress ?? undefined} aria-label="Dataset download progress">
                <span style={{ width: progress !== null ? `${progress}%` : '30%' }} className={progress === null ? 'progress-bar__indeterminate' : undefined} />
              </div>
            )}
            <div className="actions-row">
              {dataset.status !== 'installed' && dataset.status !== 'downloading' && dataset.status !== 'verifying' && dataset.status !== 'queued' && (
                <button className="btn" type="button" onClick={() => install.mutate(dataset.id)} disabled={install.isPending}>
                  {install.isPending ? 'Starting download…' : 'Download and install'}
                </button>
              )}
              {isBusy && (
                <button className="btn" type="button" disabled>
                  {dataset.status === 'queued' ? 'Starting download…' : dataset.status === 'verifying' ? 'Verifying…' : 'Downloading…'}
                </button>
              )}
              {dataset.status === 'installed' && (
                <button className="btn-danger" type="button" onClick={() => remove.mutate(dataset.id)} disabled={remove.isPending}>Remove dataset</button>
              )}
              {dataset.status === 'failed' && (
                <button className="btn" type="button" onClick={() => install.mutate(dataset.id)} disabled={install.isPending}>Retry download</button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function InstanceSettings() {
  const queryClient = useQueryClient()
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.get<{ ok: boolean; db: { ok: boolean; tables: string; migrations: string }; providers: Array<{ id: string; configured: boolean; status: string }>; seed: { demo: boolean } }>('/api/health') })
  const instance = useQuery({ queryKey: ['instance'], queryFn: () => api.get<{ name: string }>('/api/v1/instance') })
  const [name, setName] = useState<string | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (instance.data) setName(instance.data.name) }, [instance.data])
  const save = useMutation({ mutationFn: (value: string) => api.patch('/api/v1/admin/instance', { name: value }), onSuccess: () => { setSaved(true); void queryClient.invalidateQueries({ queryKey: ['instance'] }) } })
  return (
    <div className="settings-stack">
      <form className="data-panel" onSubmit={(e) => { e.preventDefault(); if (name?.trim()) save.mutate(name.trim()) }}>
        <h2 className="data-panel__title">Instance</h2>
        <div className="field">
          <label htmlFor="instance-name">Instance name</label>
          <input id="instance-name" className="input" maxLength={80} required value={name ?? ''} onChange={(e) => { setName(e.target.value); setSaved(false) }} />
        </div>
        {saved && <p role="status" className="form-note">Instance name saved.</p>}
        <button className="btn" type="submit" disabled={save.isPending || !name?.trim()}>
          {save.isPending ? 'Saving…' : 'Save instance settings'}
        </button>
      </form>
      <div className="data-panel">
        <h2 className="data-panel__title">Instance health</h2>
        {health.isPending ? <p>Checking health…</p> : health.isError ? <p role="alert" className="form-error">Health check failed.</p> : (
          <>
            <p>Database: {health.data.db.ok ? 'connected' : 'unavailable'} · {health.data.db.tables} tables · {health.data.db.migrations}</p>
            <p>Demo mode: {health.data.seed.demo ? 'enabled' : 'disabled'}</p>
            <ul>{health.data.providers.map((p) => <li key={p.id}>{p.id}: {p.configured ? 'configured' : 'not configured'} · {p.status}</li>)}</ul>
          </>
        )}
        <p className="attribution">Admins run the host and may technically access database files. User interfaces enforce account-level isolation.</p>
      </div>
    </div>
  )
}

function ReferenceData() {
  const q = useQuery({ queryKey: ['reference-datasets'], queryFn: () => api.get<{ datasets: Array<{ key: string; name: string; description: string; source: string; license: string; attribution: string; status: string; version: string | null; recordCount: number | null; sizeBytes: number | null; installedAt: string | null; error: string | null }> }>('/api/v1/reference/datasets') })
  const qc = useQueryClient()
  const install = useMutation({ mutationFn: (key: string) => api.post(`/api/v1/reference/datasets/${key}/install`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['reference-datasets'] }), onError: () => void qc.invalidateQueries({ queryKey: ['reference-datasets'] }) })
  if (q.isPending) return <div className="data-panel"><p>Loading reference data…</p></div>
  if (q.isError) return <div role="alert" className="form-error">Could not load reference data. {(q.error as Error).message}</div>
  return (
    <div className="settings-stack">
      <div className="data-panel">
        <h2 className="data-panel__title">Reference data</h2>
        <p className="form-note">Instance-wide lookup tables used for airline, airport and aircraft resolution. Separate from historical flight archives.</p>
      </div>
      {q.data.datasets.map((d) => (
        <div className="data-panel" key={d.key}>
          <h3 className="data-panel__title">{d.name}</h3>
          <p className="form-note">{d.description}</p>
          <p className="form-note">Source: {d.source} · {d.license} · Status: {d.status}</p>
          <p className="attribution">{d.attribution}</p>
          {d.recordCount !== null && <p className="form-note">Records: {d.recordCount.toLocaleString()}</p>}
          {d.installedAt && <p className="form-note">Installed: {new Date(d.installedAt).toLocaleString()}</p>}
          {d.error && <p role="alert" className="form-error">{d.error}</p>}
          <div className="actions-row">
            {d.status !== 'installed' && (
              <button className="btn" type="button" onClick={() => install.mutate(d.key)} disabled={install.isPending}>
                {install.isPending ? 'Installing…' : 'Install / update'}
              </button>
            )}
            {d.status === 'installed' && d.source !== 'seed' && (
              <button className="btn-outline" type="button" onClick={() => install.mutate(d.key)} disabled={install.isPending}>
                {install.isPending ? 'Updating…' : 'Update'}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
