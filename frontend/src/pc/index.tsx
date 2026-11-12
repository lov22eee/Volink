// PC 화면 입구 (2026-11-11): anyone browses posts; 기관 accounts get 기관센터, the admin gets the console, and personal
// accounts are pointed to the app. The QR check-in page and the Kakao/Google return pages keep the old web screens.
import { useCallback, useEffect, useState } from 'react'
import App, { ToastHost } from '../App'
import { logout, mayHaveSession, refresh } from '../api'
import type { User } from '../api'
import { AdminConsole } from './admin'
import { OrgCenter, OrgPending } from './org'
import { AppOnly, OrgEntry, OrgPage, OrgSignup, PcLogin, PublicDetail, PublicHome } from './public'
import { Loading } from './ui'
import './pc.css'

type Route = { path: string; parts: string[]; query: URLSearchParams }
function read(): Route {
  const [path, q = ''] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) }
}
const LEGACY = /^(checkin\/\d+|oauth|social-signup)$/

export default function PcApp() {
  const [route, setRoute] = useState(read)
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const go = () => { setRoute(read()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [])
  const restore = useCallback(() => {
    if (!mayHaveSession()) { setReady(true); return }
    refresh().then(setUser).catch(() => setUser(null)).finally(() => setReady(true))
  }, [])
  useEffect(restore, [restore])
  // The route moves to #/ in the same render as the user leaves, so a login-only page never sends to #/login on the way out.
  const signOut = useCallback(async () => { await logout().catch(() => {}); window.location.hash = '#/'; setRoute(read()); setUser(null) }, [])

  const p = route.parts
  const institution = user?.memberType === 'INSTITUTION' && user.role !== 'ADMIN'
  const approved = institution && user?.organization?.status === 'APPROVED'
  // Old web addresses used inside the reused screens (create / edit / my list) lead into 기관센터.
  useEffect(() => {
    if (!approved) return
    if (p[0] === 'create') window.location.replace('#/org/create')
    else if (p[0] === 'mine') window.location.replace('#/org/activities')
    else if (p[0] === 'activity' && p[1] && p[2] === 'edit') window.location.replace('#/org/activity/' + p[1] + '/edit')
  }, [approved, p])
  useEffect(() => { if (p[0] === 'signup') window.location.replace('#/org/signup') }, [p])

  if (LEGACY.test(route.path)) return <App />
  const needLogin = (next: string) => { window.location.replace('#/login?next=' + encodeURIComponent(next)); return null }
  let page
  if (p[0] === 'admin') {
    if (!ready) page = <Loading />
    else if (!user) page = needLogin('#/' + route.path)
    else if (user.role !== 'ADMIN') page = user.memberType === 'INSTITUTION' ? <OrgPending user={user} onSignOut={signOut} /> : <AppOnly user={user} onSignOut={signOut} />
    else page = <AdminConsole parts={p} query={route.query} user={user} onSignOut={signOut} />
  } else if (p[0] === 'org' && p[1] === 'signup') page = <OrgSignup onSession={setUser} />
  else if (p[0] === 'org') {
    if (!ready) page = <Loading />
    else if (!user) page = p.length > 1 ? needLogin('#/' + route.path) : <OrgEntry onSession={setUser} user={null} onSignOut={signOut} />
    else if (user.role === 'ADMIN') { window.location.replace('#/admin'); page = null }
    else if (!institution) page = <AppOnly user={user} onSignOut={signOut} />
    else if (!approved) page = <OrgPending user={user} onSignOut={signOut} />
    else page = <OrgCenter parts={p} query={route.query} user={user} onSignOut={signOut} onChange={restore} />
  } else if (p[0] === 'login') page = <PcLogin onSession={setUser} />
  else if (p[0] === 'app') page = ready && user ? <AppOnly user={user} onSignOut={signOut} /> : ready ? <PublicHome user={null} onSignOut={signOut} /> : <Loading />
  else if (p[0] === 'o' && p[1]) page = <OrgPage key={p[1]} id={Number(p[1])} user={user} onSignOut={signOut} />
  else if (p[0] === 'activity' && p[1] && !p[2]) page = <PublicDetail key={p[1]} id={Number(p[1])} user={user} onSignOut={signOut} />
  else page = <PublicHome user={user} onSignOut={signOut} />
  return <>{page}<ToastHost /></>
}
