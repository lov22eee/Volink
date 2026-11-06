// Android app (APK) screens. Built with `vite --mode app`; the web site keeps its own design (src/App.tsx).
// Login first: nothing else is reachable before signing in. Five bottom tabs: 홈 / 찾기 / 커뮤니티 / 내 활동 / 마이.
import { useCallback, useEffect, useState } from 'react'
import { api, logout, mayHaveSession, refresh } from '../api'
import { AccountScreen, SettingsScreen, applyTextSize } from './settings'
import type { User } from '../api'
import { ToastHost, showToast } from '../App'
import { CheckInPage } from '../checkin'
import './app.css'
import { Login, OrgReview, Signup, SocialDone, SocialSignup } from './auth'
import { ImeLab } from './imeLab'
import { ActivityScreen, ManageScreen } from './detail'
import { CommunityScreen, PostScreen, WriteScreen } from './community'
import { FindScreen } from './find'
import { HomeScreen } from './home'
import { NewsScreen } from './news'
import { CreateWizard, HostScreen } from './host'
import { MineScreen } from './mine'
import { setupNative, startPush, stopPush } from './native'
import { WelcomeScreen } from './welcome'
import { MyScreen, NicknameScreen, SavedScreen, InterestsScreen } from './my'
import { NoticeSettingsScreen, NoticesScreen } from './notices'
import { BellLink, Loading, MIcon, TabBar, TopBar, useKeyboardAware } from './ui'
import type { Tab } from './ui'

setupNative()

type Route = { page: string; id?: number; query: URLSearchParams }

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const [page = 'home', id] = path.split('/')
  return { page: page || 'home', id: id && /^\d+$/.test(id) ? Number(id) : undefined, query: new URLSearchParams(query) }
}

function useRoute() {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const change = () => { setRoute(parse(window.location.hash)); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  return route
}

export default function MobileApp() {
  const route = useRoute()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [unread, setUnread] = useState(0)
  useKeyboardAware()

  useEffect(() => {
    document.documentElement.classList.add('m-app')
    applyTextSize()
    if (!mayHaveSession()) { setReady(true); return }
    refresh().then(setUser).catch(() => setUser(null)).finally(() => setReady(true))
  }, [])
  const pollUnread = useCallback(() => {
    if (!user) return
    api<{ unread: number }>('/api/me/notifications?unread=true').then(data => setUnread(data.unread)).catch(() => {})
  }, [user])
  useEffect(() => {
    pollUnread()
    if (!user) return
    const timer = window.setInterval(pollUnread, 30_000)
    return () => window.clearInterval(timer)
  }, [user, pollUnread, route.page])

  const signOut = useCallback(async () => { await stopPush(); await logout(); setUser(null); window.location.hash = '#/login' }, [])
  // Signed in on the phone: hand this phone's push token to the server (only when notifications are allowed).
  useEffect(() => { if (user) void startPush() }, [user?.id])
  const onSession = (signed: User) => { setUser(signed); if (['login', 'signup', ''].includes(parse(window.location.hash).page)) window.location.hash = '#/home' }

  // 한글 입력 진단: open with or without signing in.
  if (route.page === 'ime-lab') return <ImeLab />
  if (!ready) return <div className="m-boot"><span className="m-logo"><MIcon name="leaf" size={44} /></span></div>
  // A QR scanned with the phone camera opens the check-in link; after signing in it continues there.
  if (!user) {
    if (route.page === 'checkin' && route.id) try { sessionStorage.setItem('volink.next', window.location.hash) } catch { /* private mode */ }
    if (route.page === 'oauth') return <SocialDone onSession={signed => { onSession(signed); window.location.hash = '#/home' }} />
    if (route.page === 'social-signup') return <><SocialSignup onSession={onSession} /><ToastHost /></>
    return route.page === 'signup' ? <><Signup key={route.query.get('type') ?? ''} institution={route.query.get('type') === 'institution'} onSession={onSession} /><ToastHost /></> : <><ToastHost /><Login onSession={user => {
      onSession(user)
      let next: string | null = null
      try { next = sessionStorage.getItem('volink.next'); sessionStorage.removeItem('volink.next') } catch { /* private mode */ }
      window.location.hash = next ?? '#/home'
    }} /></>
  }
  // 기관회원 not (yet) confirmed: the review status only, read again on 다시 확인.
  if (user.memberType === 'INSTITUTION' && user.organization?.status !== 'APPROVED') return <><ToastHost /><OrgReview user={user} onSignOut={signOut}
    onRefresh={async quiet => { try { const fresh = await api<User>('/api/me'); setUser(fresh); if (fresh.organization?.status === 'APPROVED') { showToast('기관 확인이 끝났어요'); window.location.hash = '#/home' } else if (!quiet) showToast('아직 확인 중이에요') } catch { if (!quiet) showToast('지금은 확인하지 못했어요') } }} /></>
  if (user.role === 'ADMIN') return <div className="m-screen"><TopBar brand /><div className="m-body"><div className="m-note">관리자 기능은 PC에서 이용해 주세요.</div><button className="m-btn line" onClick={signOut}>로그아웃</button></div></div>

  const bell = <BellLink unread={unread} />
  const search = <a href="#/find?focus=1" className="m-icon-btn" aria-label="검색"><MIcon name="search" /></a>
  const tab: Tab | null = (['home', 'find', 'community', 'mine', 'my'] as Tab[]).includes(route.page as Tab) ? route.page as Tab : null
  let screen
  switch (route.page) {
    case 'home': screen = <HomeScreen user={user} actions={<>{search}{bell}</>} />; break
    case 'find': screen = <FindScreen actions={bell} focus={route.query.get('focus') === '1'} initial={route.query.get('chip') ?? undefined} category={route.query.get('category') ?? undefined} />; break
    case 'host': screen = <HostScreen user={user} actions={bell} />; break
    case 'community': screen = <CommunityScreen actions={<>{search}{bell}</>} />; break
    case 'post': screen = route.id ? <PostScreen key={route.id} id={route.id} onChange={pollUnread} /> : null; break
    case 'write': screen = <WriteScreen key={'w' + (route.query.get('edit') ?? '')} initial={route.query.get('category') ?? undefined} activity={Number(route.query.get('activity')) || undefined} editId={Number(route.query.get('edit')) || undefined} />; break
    case 'create': screen = <CreateWizard user={user} from={Number(route.query.get('from')) || undefined} />; break
    case 'edit': screen = route.id ? <CreateWizard key={'edit' + route.id} user={user} editId={route.id} /> : null; break
    case 'mine': screen = <MineScreen actions={bell} initial={route.query.get('tab') ?? undefined} />; break
    case 'my': screen = route.id === undefined && route.query.get('view') === 'saved' ? <SavedScreen /> : route.query.get('view') === 'interests' ? <InterestsScreen user={user} onChange={setUser} /> : route.query.get('view') === 'nickname' ? <NicknameScreen /> : route.query.get('view') === 'notice-settings' ? <NoticeSettingsScreen /> : <MyScreen user={user} actions={bell} />; break
    case 'activity': screen = route.id ? <ActivityScreen key={route.id} id={route.id} user={user} onChange={pollUnread} /> : null; break
    case 'manage': screen = route.id ? <ManageScreen key={route.id} id={route.id} user={user} onChange={pollUnread} initial={route.query.get('tab') ?? undefined} /> : null; break
    case 'checkin': screen = route.id ? <div className="m-screen"><TopBar title="체크인" back="#/home" /><div className="m-body m-legacy"><CheckInPage key={route.id} id={route.id} token={route.query.get('t') ?? undefined} user={user} ready /></div></div> : null; break
    case 'news': screen = route.id ? <NewsScreen key={route.id} id={route.id} user={user} /> : null; break
    case 'notifications': screen = <NoticesScreen onChange={pollUnread} />; break
    case 'settings': screen = route.query.get('view') === 'account' ? <AccountScreen onWithdrawn={signOut} /> : <SettingsScreen user={user} onSignOut={signOut} />; break
    case 'welcome': screen = <WelcomeScreen />; break
    default: screen = null
  }
  if (!screen) { window.location.hash = '#/home'; return <Loading /> }
  return <div className={'m-shell' + (tab ? ' has-tabs' : '')}>
    {screen}
    {tab && <TabBar active={tab} />}
    <ToastHost />
  </div>
}
