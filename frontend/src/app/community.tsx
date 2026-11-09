// 커뮤니티 (bottom tab): 자유 · 질문 · 봉사후기. Reviews are tied to an activity the writer completed ("참여 확인").
// Names are partly hidden; contact details are refused by the server. No example posts: an empty board says so.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, ApiError } from '../api'
import { friendlyTime, showToast } from '../App'
import type { ExternalRecord } from './record'
import { ActionBar, dayWord, Empty, go, goBack, Loading, MIcon, Sheet, TopBar, TextArea, TextInput } from './ui'

type Category = 'FREE' | 'QUESTION' | 'REVIEW' | 'PROMO'
export type PostSummary = { id: number; category: Category; title: string; preview: string; author: string; mine: boolean; createdAt: string; likes: number; comments: number; liked: boolean; verified: boolean; activityId: number | null; activityTitle: string | null; activityDate: string | null; activityCategory?: string | null; edited?: boolean
  /** 봉사 홍보 (PROMO): the live activity card. */
  activityTime?: string | null; activityPlace?: string | null; activityCapacity?: number | null; activityConfirmed?: number | null; activityOpen?: boolean
  /** Week 7: seats held (with open offers), waiting list, applications to answer, whether the waiting list is open, reviews of it,
   *  whether I run it, and my own place in it (APPLIED / WAITLISTED / OFFERED / CONFIRMED …). */
  activityTaken?: number; activityWaiting?: number; activityPending?: number; activityWaitOpen?: boolean; activityReviews?: number; activityOrganizer?: boolean
  myStatus?: string | null; myWaitOrder?: number | null
  /** 봉사후기 (week 7): where it comes from — a completed participation, the organizer's own activity or a 1365 record. */
  reviewSource?: 'JOIN' | 'HOST' | 'EXTERNAL' | null
  /** 1365 review (V27): the person's own record — 본인 기록, or 실적확인서 있음. */
  externalId?: number | null; externalTitle?: string | null; externalDate?: string | null; externalCertified?: boolean | null }
type Comment = { id: number; body: string; author: string; mine: boolean; organizer: boolean; postAuthor: boolean; createdAt: string; edited?: boolean }
type Post = Omit<PostSummary, 'preview'> & { body: string; comments: Comment[] }
type Reviewable = { id: number; title: string; date: string; durationMinutes: number; hosted?: boolean; people?: number }
type Promotable = { id: number; title: string; status: string; date: string; startTime: string; capacity: number; confirmed: number; promoPostId: number | null; promoTitle: string | null }

export const categoryLabel: Record<Category, string> = { FREE: '자유', QUESTION: '질문', REVIEW: '봉사후기', PROMO: '봉사 홍보' }
const order: Category[] = ['FREE', 'QUESTION', 'REVIEW', 'PROMO']
const badgeTone = (c: Category) => c === 'REVIEW' ? 'mint' : c === 'PROMO' ? 'amber' : 'gray'
// The server sends "yyyy-MM-ddTHH:mm"; friendlyTime reads "yyyy-MM-dd HH:mm".
const ago = (value: string) => friendlyTime(value.replace('T', ' '))
// "같이 할 분 구해요" kind of posts belong in 모집 (safety review, no contact exchange).
const meetup = /(같이|함께).{0,12}(하실|할|가실|갈|하실래|해요|모여)|(구해요|구합니다|모여요|모집해요|모집합니다|만나요)/

export function PostCard({ post }: { post: PostSummary }) {
  return <a className="c-card" href={'#/post/' + post.id}>
    <div className="c-card-top"><span className={'m-badge ' + badgeTone(post.category)}>{categoryLabel[post.category]}</span>
      {post.category === 'REVIEW' && post.reviewSource ? <SourceBadge post={post} /> : post.verified && <span className="c-verified"><MIcon name="check" size={14} />참여 확인</span>}
      <small>{ago(post.createdAt)} · {post.author}{post.mine ? ' (나)' : ''}</small></div>
    <strong>{post.title}</strong>
    <p>{post.preview}</p>
    {post.category === 'PROMO' && post.activityId ? <PromoCard post={post} />
      : post.externalTitle ? <span className="c-act ext"><b>1365</b>{post.externalTitle}<em>{post.externalCertified ? '실적확인서 있음' : '본인 기록'}</em></span>
      : post.activityTitle && <span className="c-act"><MIcon name="leaf" size={15} />{post.activityTitle}</span>}
    <div className="c-foot"><span className={post.liked ? 'on' : ''}><MIcon name="heart" size={17} />{post.likes}</span><span><MIcon name="chat" size={17} />{post.comments}</span></div>
  </a>
}

const dateText = (date: string | null) => date ? Number(date.slice(5, 7)) + '월 ' + Number(date.slice(8, 10)) + '일' : null
/**
 * 봉사 홍보의 연결된 모집 (live): field, date and time, place, seats left; 바로 신청하기 opens the activity, where applying
 * keeps every rule (capacity, waiting list, auto approve). Closed or started → 모집 마감.
 */
function PromoCard({ post, big }: { post: Omit<PostSummary, 'preview'>; big?: boolean }) {
  // Week 7 (2026-11-09): the same rules as the activity page — my own post → 모집 관리; my application → its state;
  // seats → 신청하기; full with the waiting list open → 대기 신청하기 (amber); otherwise 모집 마감, and once it is over its reviews.
  const left = Math.max(0, (post.activityCapacity ?? 0) - (post.activityTaken ?? post.activityConfirmed ?? 0))
  const open = Boolean(post.activityOpen)
  const to = (hash: string) => (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); window.location.hash = hash }
  const mineWord: Record<string, string> = { APPLIED: '승인 대기', WAITLISTED: `대기 ${post.myWaitOrder ?? ''}번`, OFFERED: '자리 제안 · 확인하기', CONFIRMED: '참가 확정 ✓', CHECKED_IN: '출석 완료 ✓', COMPLETED: '참여 완료 ✓' }
  let state: string, button: ReactNode
  if (post.activityOrganizer) {
    state = `확정 ${post.activityConfirmed ?? 0} · 대기 ${post.activityWaiting ?? 0}`
    button = <button type="button" className="line" onClick={to('#/manage/' + post.activityId)}>모집 관리<MIcon name="chevron" size={15} /></button>
  } else if (post.myStatus && mineWord[post.myStatus]) {
    state = '내 신청'
    button = <button type="button" className={post.myStatus === 'OFFERED' ? 'hot' : 'mine'} onClick={to('#/activity/' + post.activityId)}>{mineWord[post.myStatus]}</button>
  } else if (!open) {
    state = '모집 마감'
    button = <button type="button" disabled>모집 마감</button>
  } else if (left > 0) {
    state = `${left}자리 남음`
    button = <button type="button" onClick={to('#/activity/' + post.activityId)}>신청하기<MIcon name="chevron" size={15} /></button>
  } else if (post.activityWaitOpen) {
    state = `정원 마감 · 대기 ${post.activityWaiting ?? 0}명`
    button = <button type="button" className="amber" onClick={to('#/activity/' + post.activityId)}>대기 신청하기</button>
  } else {
    state = '모집 마감'
    button = <button type="button" disabled>모집 마감</button>
  }
  const reviews = post.activityReviews ?? 0
  return <span className={'c-promo' + (big ? ' big' : '') + (open || post.activityOrganizer ? '' : ' closed')} role="group" aria-label="연결된 봉사 모집">
    <small>연결된 봉사 모집{post.activityCategory ? ' · ' + post.activityCategory : ''}</small>
    <b>{post.activityTitle}</b>
    <span>{[dateText(post.activityDate), post.activityTime, post.activityPlace].filter(Boolean).join(' · ')}</span>
    <span className="c-promo-foot"><em>{state}</em>{button}</span>
    {post.activityOrganizer && (post.activityPending ?? 0) > 0 && <span className="c-promo-note">새 신청 {post.activityPending}건이 승인을 기다려요</span>}
    {big && !open && reviews > 0 && <a className="c-promo-reviews" href={'#/community?activity=' + post.activityId} onClick={event => event.stopPropagation()}><MIcon name="chat" size={16} />이 활동의 후기 {reviews}개<MIcon name="chevron" size={15} /></a>}
  </span>
}

/** 봉사후기 출처 (week 7): Volink 참여 / 모집자 후기 / 1365 본인 기록 · 실적확인서 있음 — never "checked by Volink" for 1365. */
function SourceBadge({ post }: { post: Pick<PostSummary, 'reviewSource' | 'externalCertified'> }) {
  if (post.reviewSource === 'HOST') return <span className="c-src host">모집자 후기</span>
  if (post.reviewSource === 'EXTERNAL') return <span className="c-src ext">{post.externalCertified ? '1365 · 실적확인서 있음' : '1365 본인 기록'}</span>
  return <span className="c-src join"><MIcon name="check" size={13} />Volink 참여</span>
}

type Profile = { nickname: string | null; agreed: boolean; ready: boolean; nextChange: string | null }
const adjectives = ['따뜻한', '부지런한', '다정한', '씩씩한', '포근한', '반짝이는', '느긋한', '상냥한', '든든한', '싱그러운', '활짝 핀', '산뜻한']
const nouns = ['자몽', '도토리', '민들레', '해바라기', '참새', '새싹', '고구마', '귤', '다람쥐', '토끼', '소나무', '구름']
const randomNickname = () => adjectives[Math.floor(Math.random() * adjectives.length)] + ' ' + nouns[Math.floor(Math.random() * nouns.length)]
const rules = ['전화번호·이메일·오픈채팅 같은 연락처를 올리지 않아요.', '다른 사람을 비방하거나 차별하는 글을 쓰지 않아요.', '외부 광고·모금 글을 올리지 않아요. 봉사 홍보는 내 모집글을 연결한 ‘봉사 홍보’ 글로만 해요.', '같이 활동할 사람은 커뮤니티가 아니라 ‘모집’으로 구해요.', '규칙을 어긴 글은 지워지고 이용이 제한될 수 있어요.']

/** First visit (and 마이 > 커뮤니티 닉네임): a nickname shown instead of the name, and the community rules. */
export function CommunitySetup({ profile, onDone, change }: { profile: Profile | null; onDone: (profile: Profile) => void; change?: boolean }) {
  const [nickname, setNickname] = useState(profile?.nickname ?? randomNickname())
  const [agree, setAgree] = useState(Boolean(profile?.agreed))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const length = nickname.trim().length
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onDone(await api<Profile>('/api/community/me', 'PUT', { nickname: nickname.trim(), agree }))
      showToast(change ? '닉네임을 바꿨어요' : '커뮤니티에 오신 걸 환영해요')
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.fieldErrors.nickname ?? cause.fieldErrors.agree ?? cause.message) : '저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  return <form className="m-body m-form" onSubmit={submit} noValidate>
    {!change && <section className="c-banner"><strong><MIcon name="sprout" size={20} />커뮤니티를 시작해요</strong><span>여기서는 실제 이름 대신 닉네임으로 보여요.</span></section>}
    <label className="m-field"><span className="m-label">닉네임 <small>{CommunityNick.min}~{CommunityNick.max}자 · 한글·영문·숫자</small></span>
      <span className="m-input with-peek"><TextInput aria-label="닉네임" maxLength={CommunityNick.max} value={nickname} onChange={event => { setNickname(event.target.value); setError('') }} enterKeyHint="done" />
        <button type="button" className="m-peek" aria-label="닉네임 새로 추천받기" onClick={() => { setNickname(randomNickname()); setError('') }}><MIcon name="refresh" size={20} /></button></span>
      <span className="m-help">닉네임은 30일에 한 번 바꿀 수 있어요.{profile?.nextChange && change ? ` (${profile.nextChange.slice(5).replace('-', '/')}부터)` : ''}</span></label>
    {!change && <div className="m-field"><span className="m-label">커뮤니티 이용 규칙</span>
      <ul className="c-rules">{rules.map(rule => <li key={rule}><MIcon name="check" size={16} />{rule}</li>)}</ul>
      <label className={'m-check box' + (error && !agree ? ' bad' : '')}><input type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)} /><span className="m-box" /><span>이용 규칙을 읽었고 지킬게요 (필수)</span></label></div>}
    {error && <p className="m-err" role="alert">{error}</p>}
    <ActionBar><button className="m-btn" disabled={busy || length < CommunityNick.min || (!change && !agree)}>{change ? '닉네임 저장' : '동의하고 시작하기'}</button></ActionBar>
  </form>
}
export const CommunityNick = { min: 2, max: 10 }

/**
 * First visit, step by step (user's idea 2026-11-05): the greeting fades in at the centre, then moves up and shrinks;
 * the nickname field appears under it; after 다음 the rules come up in a bottom sheet; 시작하기 opens the board.
 */
function CommunityOnboarding({ profile, onDone }: { profile: Profile | null; onDone: (profile: Profile) => void }) {
  const calm = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [stage, setStage] = useState<'hello' | 'nick'>(calm ? 'nick' : 'hello')
  const [nickname, setNickname] = useState(profile?.nickname ?? randomNickname())
  const [rulesOpen, setRulesOpen] = useState(false)
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (stage === 'hello') { const t = window.setTimeout(() => setStage('nick'), 1400); return () => window.clearTimeout(t) } }, [stage])
  const length = nickname.trim().length
  const valid = length >= CommunityNick.min && length <= CommunityNick.max && /^[가-힣A-Za-z0-9 ]+$/.test(nickname.trim())
  async function start() {
    setBusy(true)
    setError('')
    try {
      const saved = await api<Profile>('/api/community/me', 'PUT', { nickname: nickname.trim(), agree })
      showToast('커뮤니티에 오신 걸 환영해요', saved.nickname + ' 님')
      onDone(saved)
    } catch (cause) {
      const message = cause instanceof ApiError ? (cause.fieldErrors.nickname ?? cause.fieldErrors.agree ?? cause.message) : '저장하지 못했어요.'
      setError(message)
      if (cause instanceof ApiError && cause.fieldErrors.nickname) setRulesOpen(false)
    } finally {
      setBusy(false)
    }
  }
  return <div className={'m-screen c-onb ' + stage}>
    <TopBar title="" />
    <div className="c-hello" aria-live="polite"><span className="c-hello-ico"><MIcon name="chat" size={34} /></span><h1>커뮤니티를 시작할게요!</h1><p>여기서는 실제 이름 대신 닉네임으로 보여요.</p></div>
    <form id="c-nick" className="c-nick" onSubmit={event => { event.preventDefault(); if (valid) { (document.activeElement as HTMLElement | null)?.blur(); setRulesOpen(true) } }} noValidate aria-hidden={stage === 'hello'}>
      <label className="m-field"><span className="m-label">닉네임 <small>{CommunityNick.min}~{CommunityNick.max}자 · 한글·영문·숫자</small></span>
        <span className={'m-input with-peek' + (error && !rulesOpen ? ' bad' : '')}><TextInput aria-label="닉네임" maxLength={CommunityNick.max} value={nickname} tabIndex={stage === 'hello' ? -1 : 0}
          onChange={event => { setNickname(event.target.value); setError('') }} enterKeyHint="next" />
          <button type="button" className="m-peek" aria-label="닉네임 새로 추천받기" tabIndex={stage === 'hello' ? -1 : 0} onClick={() => { setNickname(randomNickname()); setError('') }}><MIcon name="refresh" size={20} /></button></span>
        <span className="m-help">닉네임은 30일에 한 번 바꿀 수 있어요.</span>
        {error && !rulesOpen && <span className="m-err" role="alert">{error}</span>}</label>
    </form>
    {/* Outside the sliding form: a fixed bar inside a transformed parent sticks to that parent (it covered the field). */}
    <ActionBar><button form="c-nick" className="m-btn" disabled={!valid || stage === 'hello'} tabIndex={stage === 'hello' ? -1 : 0}>다음</button></ActionBar>
    {rulesOpen && <Sheet title="커뮤니티 이용 규칙" onClose={() => setRulesOpen(false)}
      footer={<>{error && <p className="m-err" role="alert">{error}</p>}<button type="button" className="m-btn" disabled={!agree || busy} onClick={start}>{busy ? '들어가는 중…' : '시작하기'}</button></>}>
      <p className="m-help"><b>{nickname.trim()}</b> 님, 함께 지켜 주세요.</p>
      <ul className="c-rules">{rules.map(rule => <li key={rule}><MIcon name="check" size={16} />{rule}</li>)}</ul>
      <label className="m-check box"><input type="checkbox" checked={agree} onChange={event => setAgree(event.target.checked)} /><span className="m-box" /><span>이용 규칙을 읽었고 지킬게요 (필수)</span></label>
    </Sheet>}
  </div>
}

/**
 * 모집글에 보일 닉네임 (week 7, 공개 이름 통일): someone opening a 모집 without a community nickname picks one first — the
 * same nickname as in the community, shown on 찾기·상세·홍보 instead of the name. Skipped when one is already set.
 */
export function NicknameGate() {
  const [need, setNeed] = useState(false)
  const [nickname, setNickname] = useState(randomNickname())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Profile>('/api/community/me').then(p => setNeed(!p.nickname)).catch(() => {}) }, [])
  if (!need) return null
  async function save() {
    setBusy(true); setError('')
    try { await api('/api/community/me', 'PUT', { nickname: nickname.trim(), agree: true }); setNeed(false); showToast('닉네임을 정했어요', nickname.trim() + ' 님으로 보여요') }
    catch (cause) { setError(cause instanceof ApiError ? (cause.fieldErrors.nickname ?? cause.message) : '저장하지 못했어요.') } finally { setBusy(false) }
  }
  return <Sheet title="모집글에 보일 닉네임" onClose={() => go('#/home')}
    footer={<button type="button" className="m-btn" disabled={busy || nickname.trim().length < CommunityNick.min} onClick={save}>동의하고 이 닉네임으로 시작</button>}>
    <p className="m-help">찾기·상세·커뮤니티에는 이름 대신 닉네임이 보여요. 실명은 참가가 확정된 사람에게만 보여요.</p>
    <span className="m-input with-peek"><TextInput aria-label="닉네임" maxLength={CommunityNick.max} value={nickname} onChange={event => { setNickname(event.target.value); setError('') }} enterKeyHint="done" />
      <button type="button" className="m-peek" aria-label="닉네임 새로 추천받기" onClick={() => setNickname(randomNickname())}><MIcon name="refresh" size={20} /></button></span>
    <p className="m-help">{CommunityNick.min}~{CommunityNick.max}자 · 커뮤니티와 같은 닉네임 · 커뮤니티 이용 규칙에 동의해요</p>
    {error && <p className="m-err" role="alert">{error}</p>}
  </Sheet>
}

export function CommunityScreen({ actions, activity }: { actions: ReactNode; activity?: number }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  useEffect(() => { api<Profile>('/api/community/me').then(setProfile).catch(() => setProfile(null)) }, [])
  if (profile === undefined) return <div className="m-screen"><TopBar title="커뮤니티" actions={actions} /><Loading /></div>
  if (!profile?.ready) return <CommunityOnboarding profile={profile ?? null} onDone={setProfile} />
  return <CommunityBoard actions={actions} activity={activity} />
}

function CommunityBoard({ actions, activity }: { actions: ReactNode; activity?: number }) {
  const [category, setCategory] = useState<Category | ''>(activity ? 'REVIEW' : '')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [items, setItems] = useState<PostSummary[] | null>(null)
  useEffect(() => {
    let current = true
    setItems(null)
    const params = new URLSearchParams({ sort })
    if (category) params.set('category', category)
    if (activity) params.set('activity', String(activity))
    api<PostSummary[]>('/api/community/posts?' + params).then(list => { if (current) setItems(list) }).catch(() => { if (current) setItems([]) })
    return () => { current = false }
  }, [category, sort, activity])
  return <div className="m-screen">
    <TopBar title="커뮤니티" actions={actions} />
    <div className="m-body c-list">
      <section className="c-banner"><strong><MIcon name="sprout" size={20} />함께하는 봉사 이야기</strong><span>궁금한 건 묻고, 따뜻한 경험은 나눠요.</span></section>
      <div className="m-chips" role="group" aria-label="글 종류">
        <button type="button" className={'m-chip' + (category === '' ? ' on' : '')} aria-pressed={category === ''} onClick={() => setCategory('')}>전체</button>
        {order.map(c => <button key={c} type="button" className={'m-chip' + (category === c ? ' on' : '')} aria-pressed={category === c} onClick={() => setCategory(c)}>{categoryLabel[c]}</button>)}
      </div>
      <div className="m-result-head"><h2>게시글</h2>
        <div className="c-sort" role="radiogroup" aria-label="정렬">{(['latest', 'popular'] as const).map(key =>
          <button key={key} type="button" role="radio" aria-checked={sort === key} className={sort === key ? 'on' : ''} onClick={() => setSort(key)}>
            {sort === key && <MIcon name="check" size={15} />}{key === 'latest' ? '최신순' : '인기순'}</button>)}</div></div>
      {!items ? <Loading /> : items.length ? <div className="m-list">{items.map(post => <PostCard key={post.id} post={post} />)}</div>
        : <Empty icon="chat" title={category ? `아직 ${categoryLabel[category]} 글이 없어요` : '아직 글이 없어요'} text="첫 글을 남겨 이웃과 이야기를 시작해 보세요." action={<a className="m-btn sm" href={'#/write' + (category ? '?category=' + category : '')}>글쓰기</a>} />}
    </div>
    <a className="m-fab" href={'#/write' + (category ? '?category=' + category : '')}><MIcon name="edit" size={19} />글쓰기</a>
  </div>
}

type Menu = { kind: 'post' } | { kind: 'comment'; comment: Comment }

export function PostScreen({ id, onChange }: { id: number; onChange: () => void }) {
  const [post, setPost] = useState<Post | null>(null)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState<Comment | null>(null)
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [confirm, setConfirm] = useState<{ path: string; title: string; done: string; after: () => void } | null>(null)
  const [newest, setNewest] = useState(false)
  const [error, setError] = useState('')
  const liking = useRef(false)
  const reply = useRef<HTMLInputElement>(null)
  const load = useCallback(() => api<Post>('/api/community/posts/' + id).then(setPost).catch(() => setFailed(true)), [id])
  useEffect(() => { load() }, [load])
  if (failed) return <div className="m-screen"><TopBar title="게시글" back="#/community" /><div className="m-body"><Empty icon="chat" title="글을 찾을 수 없어요" text="지워졌을 수 있어요." action={<a className="m-btn sm" href="#/community">커뮤니티로</a>} /></div></div>
  if (!post) return <div className="m-screen"><TopBar title="게시글" back="history" /><Loading /></div>

  // 좋아요: the heart changes at once; a second tap waits for the first answer; a failure puts it back.
  async function like() {
    if (!post || liking.current) return
    liking.current = true
    const before = post
    setPost({ ...post, liked: !post.liked, likes: post.likes + (post.liked ? -1 : 1) })
    try {
      const result = await api<{ liked: boolean; likes: number }>('/api/community/posts/' + id + '/like', before.liked ? 'DELETE' : 'PUT')
      setPost(current => current && { ...current, liked: result.liked, likes: result.likes })
    } catch { setPost(before); showToast('처리하지 못했어요') } finally { liking.current = false }
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      setPost(editing ? await api<Post>('/api/community/comments/' + editing.id, 'PUT', { body: text })
        : await api<Post>('/api/community/posts/' + id + '/comments', 'POST', { body: text }))
      if (editing) showToast('댓글을 고쳤어요')
      setText('')
      setEditing(null)
      onChange()
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.fieldErrors.body ?? cause.message) : '댓글을 달지 못했어요.')
    } finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm) return
    try { await api(confirm.path, 'DELETE'); showToast(confirm.done); confirm.after() } catch { showToast('지우지 못했어요') } finally { setConfirm(null) }
  }
  const comments = newest ? [...post.comments].reverse() : post.comments
  const scrollToComments = () => document.getElementById('c-comments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return <div className="m-screen c-post">
    <TopBar title="게시글" back="history" actions={<button type="button" className="m-icon-btn" aria-label="글 메뉴" onClick={() => setMenu({ kind: 'post' })}><MIcon name="more" /></button>} />
    <div className="m-body">
      <article className="c-article">
        <div className="c-card-top"><span className={'m-badge ' + badgeTone(post.category)}>{categoryLabel[post.category]}</span>
          {post.verified && <span className="c-verified"><MIcon name="checkCircle" size={15} />참여 확인</span>}</div>
        <h1>{post.title}</h1>
        <div className="c-author"><span className="m-avatar sm"><MIcon name="user" size={17} /></span>
          <span><b>{post.author}{post.mine && <em> (나)</em>}</b><small>{ago(post.createdAt)}{post.edited ? ' · 수정됨' : ''}</small></span></div>
        <p className="c-body">{post.body}</p>
        {post.externalTitle && <div className="c-linked ext">
          <span><MIcon name="calendar" size={18} /><b>함께한 1365 봉사</b></span>
          <strong>{post.externalTitle}</strong>
          <small>{[post.externalDate ? Number(post.externalDate.slice(5, 7)) + '월 ' + Number(post.externalDate.slice(8, 10)) + '일' : null, post.externalCertified ? '실적확인서 있음' : '본인 기록'].filter(Boolean).join(' · ')}</small>
          <em className="plain">Volink가 확인한 기록은 아니에요</em></div>}
        {post.category === 'PROMO' && post.activityId ? <PromoCard post={post} big /> : post.activityId && <a className="c-linked" href={'#/activity/' + post.activityId}>
          <span><MIcon name="calendar" size={18} /><b>함께한 봉사활동</b></span>
          <strong>{post.activityTitle}</strong>
          <small>{[post.activityDate ? Number(post.activityDate.slice(5, 7)) + '월 ' + Number(post.activityDate.slice(8, 10)) + '일' : null, post.activityCategory, '참여 완료'].filter(Boolean).join(' · ')}</small>
          <em>활동 상세 보기 <MIcon name="chevron" size={15} /></em></a>}
        <div className="c-stats">
          <button type="button" className={post.liked ? 'on' : ''} aria-pressed={post.liked} onClick={like}><MIcon name="heart" size={19} />좋아요 {post.likes}</button>
          <button type="button" onClick={scrollToComments}><MIcon name="chat" size={19} />댓글 {post.comments.length}</button>
        </div>
      </article>
      <section className="c-comments" id="c-comments" aria-label="댓글">
        <div className="c-comments-head"><h2>댓글 <b>{post.comments.length}</b></h2>
          {post.comments.length > 1 && <button type="button" className="m-text-btn" onClick={() => setNewest(!newest)}>{newest ? '최신순' : '등록순'}</button>}</div>
        {post.comments.length === 0 ? <div className="c-empty"><MIcon name="chat" size={26} /><strong>아직 댓글이 없어요</strong><span>첫 번째 이야기를 남겨보세요!</span></div>
          : <ul>{comments.map(c => <li key={c.id}>
            <span className="m-avatar sm"><MIcon name="user" size={16} /></span>
            <div><b>{c.author}{c.mine && <em> (나)</em>}{c.organizer && <span className="m-badge mint">모집자</span>}{c.postAuthor && !c.organizer && <span className="m-badge gray">글쓴이</span>}</b>
              <p>{c.body}</p><small>{ago(c.createdAt)}{c.edited ? ' · 수정됨' : ''}</small></div>
            <button type="button" className="m-icon-btn sm" aria-label="댓글 메뉴" onClick={() => setMenu({ kind: 'comment', comment: c })}><MIcon name="more" size={18} /></button>
          </li>)}</ul>}
      </section>
    </div>
    <form className="c-reply" onSubmit={submit}>
      {editing && <div className="c-editing"><span>댓글 고치는 중</span><button type="button" className="m-text-btn" onClick={() => { setEditing(null); setText('') }}>취소</button></div>}
      {error && <p className="m-err" role="alert">{error}</p>}
      <div><TextInput ref={reply} className="m-input" aria-label="댓글 내용" placeholder="댓글을 입력해 주세요" maxLength={500} value={text} onChange={event => { setText(event.target.value); setError('') }} enterKeyHint="send" />
        <button className="c-send" aria-label={editing ? '댓글 고치기' : '댓글 보내기'} disabled={busy || !text.trim()}><MIcon name="send" size={20} /></button></div>
    </form>
    {menu && <Sheet title={menu.kind === 'post' ? '글 메뉴' : '댓글 메뉴'} onClose={() => setMenu(null)}>
      <nav className="m-menu flat">{menu.kind === 'post'
        ? post.mine ? <>
          <button type="button" onClick={() => { setMenu(null); go('#/write?edit=' + id) }}><MIcon name="edit" size={20} /><span>글 수정</span><MIcon name="chevron" size={18} /></button>
          <button type="button" className="danger" onClick={() => { setMenu(null); setConfirm({ path: '/api/community/posts/' + id, title: '글을 지울까요?', done: '글을 지웠어요', after: () => go('#/community') }) }}><MIcon name="trash" size={20} /><span>글 삭제</span><MIcon name="chevron" size={18} /></button></>
          : <button type="button" className="danger" onClick={() => { setMenu(null); showToast('신고 기능은 곧 열려요') }}><MIcon name="alert" size={20} /><span>신고하기</span><MIcon name="chevron" size={18} /></button>
        : menu.comment.mine ? <>
          <button type="button" onClick={() => { const c = menu.comment; setMenu(null); setEditing(c); setText(c.body); window.setTimeout(() => reply.current?.focus(), 50) }}><MIcon name="edit" size={20} /><span>댓글 수정</span><MIcon name="chevron" size={18} /></button>
          <button type="button" className="danger" onClick={() => { const c = menu.comment; setMenu(null); setConfirm({ path: '/api/community/comments/' + c.id, title: '댓글을 지울까요?', done: '댓글을 지웠어요', after: load }) }}><MIcon name="trash" size={20} /><span>댓글 삭제</span><MIcon name="chevron" size={18} /></button></>
          : <button type="button" className="danger" onClick={() => { setMenu(null); showToast('신고 기능은 곧 열려요') }}><MIcon name="alert" size={20} /><span>신고하기</span><MIcon name="chevron" size={18} /></button>}
      </nav>
    </Sheet>}
    {confirm && <Sheet title={confirm.title} onClose={() => setConfirm(null)} footer={<div className="m-two"><button type="button" className="m-btn line" onClick={() => setConfirm(null)}>취소</button><button type="button" className="m-btn danger" onClick={remove}>지우기</button></div>}>
      <p className="m-help">지운 뒤에는 되돌릴 수 없어요.</p></Sheet>}
  </div>
}

const DRAFT = 'volink.communityDraft'
type Draft = { category: Category; title: string; body: string; picked: number | null }
const readDraft = (): Draft | null => { try { const raw = localStorage.getItem(DRAFT); return raw ? JSON.parse(raw) as Draft : null } catch { return null } }
const writeDraft = (draft: Draft | null) => { try { if (draft) localStorage.setItem(DRAFT, JSON.stringify(draft)); else localStorage.removeItem(DRAFT) } catch { /* storage blocked */ } }
const bodyHint: Record<Category, string> = {
  FREE: '이웃들과 나누고 싶은 이야기를 자유롭게 적어 주세요.',
  QUESTION: '궁금한 점을 적어 주세요. 준비물, 처음 참여할 때 팁 등',
  REVIEW: '어떤 활동이었는지, 좋았던 점과 아쉬운 점을 나눠 주세요.',
  PROMO: '어떤 봉사인지, 누구와 함께하면 좋은지 소개해 주세요. 신청은 아래 모집 카드에서 받아요.',
}

/** 글쓰기 (and 글 수정 with editId): kind chips, title, text; a draft is kept on the phone until it is posted. */
export function WriteScreen({ initial, activity, external, editId }: { initial?: string; activity?: number; external?: number; editId?: number }) {
  const saved = useMemo(() => editId || activity ? null : readDraft(), [editId, activity])
  const [category, setCategory] = useState<Category>(saved?.category ?? (initial === 'QUESTION' || initial === 'REVIEW' || initial === 'PROMO' ? initial : activity ? 'REVIEW' : 'FREE'))
  // 봉사 홍보: my activities still recruiting and not started (the server checks again: own, recruiting, once each).
  const [promoList, setPromoList] = useState<Promotable[] | null>(null)
  // Recruiting, not started and not introduced yet (the server checks again: own, recruiting, once each).
  const promotable = useMemo(() => promoList ? promoList.filter(a => a.status === 'RECRUITING' && !a.promoPostId) : null, [promoList])
  const [promoPick, setPromoPick] = useState<number | null>(initial === 'PROMO' ? activity ?? null : null)
  const [promoAll, setPromoAll] = useState(false)
  useEffect(() => {
    if (editId) return
    api<Promotable[]>('/api/community/promotable').then(list => {
      setPromoList(list)
      setPromoPick(current => current ?? list.find(a => a.status === 'RECRUITING' && !a.promoPostId)?.id ?? null)
    }).catch(() => setPromoList([]))
  }, [editId])
  // 칩 안내 (week 7): a kind the person cannot write yet opens a sheet saying why and what to do, instead of an empty form.
  const [gate, setGate] = useState<null | 'review' | 'promo' | 'reviewing' | 'promoted'>(null)
  const [reviewTab, setReviewTab] = useState<'ALL' | 'VOLINK' | 'EXT'>('ALL')
  const [reviewAll, setReviewAll] = useState(false)
  const [title, setTitle] = useState(saved?.title ?? '')
  const [body, setBody] = useState(saved?.body ?? '')
  const [picked, setPicked] = useState<number | null>(activity ?? saved?.picked ?? null)
  const [reviewable, setReviewable] = useState<Reviewable[] | null>(null)
  // 1365 records I said I went to and have not reviewed yet (V27).
  const [extList, setExtList] = useState<ExternalRecord[]>([])
  const [pickedExt, setPickedExt] = useState<number | null>(external ?? null)
  useEffect(() => { if (!editId) api<ExternalRecord[]>('/api/me/external').then(list => setExtList(list.filter(r => r.status === 'ATTENDED' && !r.reviewId))).catch(() => {}) }, [editId])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // ••• (2026-11-06): 임시 저장 / 미리보기 / 처음부터 다시 쓰기 / 글쓰기 규칙 instead of a second 등록 button at the top.
  const [menu, setMenu] = useState<null | 'menu' | 'preview' | 'reset' | 'rules'>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const original = useRef<{ title: string; body: string } | null>(null)
  const [loaded, setLoaded] = useState(!editId)
  useEffect(() => { if (saved && (saved.title || saved.body)) showToast('작성 중이던 글을 불러왔어요') }, [saved])
  useEffect(() => {
    if (editId) { api<Post>('/api/community/posts/' + editId).then(p => { setCategory(p.category); setTitle(p.title); setBody(p.body); original.current = { title: p.title, body: p.body }; setLoaded(true) }).catch(() => { showToast('글을 불러오지 못했어요'); go('#/community') }); return }
    api<Reviewable[]>('/api/community/reviewable').then(list => { setReviewable(list); if ((!activity || initial === 'PROMO') && !saved?.picked && list[0]) setPicked(list[0].id) }).catch(() => setReviewable([]))
  }, [activity, editId, saved])
  // Keep the draft (new posts only) as the person types.
  useEffect(() => { if (!editId && loaded) writeDraft(title || body ? { category, title, body, picked } : null) }, [editId, loaded, category, title, body, picked])
  const looksLikeMeetup = useMemo(() => category !== 'REVIEW' && category !== 'PROMO' && meetup.test(title + ' ' + body), [category, title, body])
  const canReview = (reviewable?.length ?? 0) > 0 || extList.length > 0
  const ready = title.trim().length >= 2 && body.trim().length >= 5 && (editId || (category === 'REVIEW' ? canReview && (picked || pickedExt) : category === 'PROMO' ? promoPick : true))
  async function submit(event?: FormEvent) {
    event?.preventDefault()
    const found: Record<string, string> = {}
    if (title.trim().length < 2) found.title = '제목은 2자 이상 적어 주세요.'
    if (body.trim().length < 5) found.body = '내용은 5자 이상 적어 주세요.'
    if (!editId && category === 'REVIEW' && !picked && !pickedExt) found.activityId = '후기를 남길 활동을 골라 주세요.'
    if (!editId && category === 'PROMO' && !promoPick) found.activityId = '홍보할 내 모집글을 골라 주세요.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const post = editId ? await api<Post>('/api/community/posts/' + editId, 'PUT', { title, body })
        : await api<Post>('/api/community/posts', 'POST', { category, title, body, activityId: category === 'REVIEW' ? (pickedExt ? null : picked) : category === 'PROMO' ? promoPick : null, externalId: category === 'REVIEW' && pickedExt ? pickedExt : null })
      if (!editId) writeDraft(null)
      showToast(editId ? '글을 고쳤어요' : '글을 올렸어요')
      window.location.replace('#/post/' + post.id)
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setErrors(cause.fieldErrors)
      else setErrors({ form: cause instanceof Error ? cause.message : '올리지 못했어요.' })
    } finally { setBusy(false) }
  }
  const dirty = Boolean(title.trim() || body.trim())
  const now = () => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(new Date())
  function saveDraft() { writeDraft({ category, title, body, picked }); setSavedAt(now()); setMenu(null); showToast('임시 저장했어요', '다음에 글쓰기를 열면 이어서 쓸 수 있어요') }
  function reset() {
    if (editId && original.current) { setTitle(original.current.title); setBody(original.current.body) } else { setTitle(''); setBody(''); writeDraft(null); setSavedAt(null) }
    setErrors({}); setMenu(null); showToast(editId ? '처음 내용으로 되돌렸어요' : '새로 쓸 수 있게 비웠어요')
  }
  function pick(c: Category) {
    if (c === 'REVIEW' && reviewable && !canReview) { setGate('review'); return }
    if (c === 'PROMO' && promoList && !promotable?.length) {
      setGate(promoList.some(a => a.status === 'RECRUITING') ? 'promoted' : promoList.some(a => a.status === 'REVIEW') ? 'reviewing' : 'promo'); return
    }
    setCategory(c)
  }
  const promoActivity = category === 'PROMO' ? promotable?.find(x => x.id === promoPick) : undefined
  const reviewTitle = category === 'REVIEW' ? (pickedExt ? extList.find(r => r.id === pickedExt)?.title : reviewable?.find(a => a.id === picked)?.title) : undefined
  if (!loaded) return <div className="m-screen"><TopBar title="글 수정" back="history" /><Loading /></div>
  return <div className="m-screen m-create c-write">
    <TopBar title={editId ? '글 수정' : '글쓰기'} back={() => dirty ? setLeaving(true) : goBack('#/community')}
      actions={<button type="button" className="m-icon-btn" aria-label="글쓰기 메뉴" onClick={() => setMenu('menu')}><MIcon name="more" /></button>} />
    <form className="m-body m-form" onSubmit={submit} noValidate>
      {!editId && <div className="m-field"><span className="m-label">어떤 이야기를 나눌까요?</span><div className="c-kinds">{order.map(c =>
        <button type="button" key={c} className={'m-chip' + (category === c ? ' on' : '')} aria-pressed={category === c} onClick={() => pick(c)}>{categoryLabel[c]}</button>)}</div></div>}
      {!editId && category === 'REVIEW' && (!reviewable ? <Loading /> : canReview ? (() => {
        // Week 7: one list — Volink 참여, my own finished 모집, 1365 records — with 전체 / Volink / 1365 and 전체보기.
        type Pick = { key: string; title: string; sub: string; tag: string; tone: string; on: boolean; choose: () => void }
        const volink: Pick[] = reviewable.map(a => ({ key: 'a' + a.id, title: a.title, sub: `${dayWord(a.date)} ${a.hosted ? `모집 완료 · ${a.people ?? 0}명` : '참여 완료'}`, tag: a.hosted ? '모집' : '참여', tone: a.hosted ? 'host' : 'join',
          on: !pickedExt && picked === a.id, choose: () => { setPicked(a.id); setPickedExt(null) } }))
        const ext: Pick[] = extList.map(r => ({ key: 'e' + r.id, title: r.title, sub: `${dayWord(r.date)} · ${r.certified ? '실적확인서 있음' : '본인 기록'}`, tag: '1365', tone: 'ext', on: pickedExt === r.id, choose: () => setPickedExt(r.id) }))
        const list = reviewTab === 'VOLINK' ? volink : reviewTab === 'EXT' ? ext : [...volink, ...ext]
        const row = (x: Pick) => <button type="button" key={x.key} className={'c-pick' + (x.on ? ' on' : '')} aria-pressed={x.on} onClick={() => { x.choose(); setReviewAll(false) }}>
          <span className="c-dot" /><span><b>{x.title}</b><small>{x.sub}</small></span><em className={'c-src ' + x.tone}>{x.tag}</em></button>
        return <div className="m-field"><span className="m-label">어떤 봉사의 후기인가요?</span>
          <div className="m-seg wide c-rtabs" role="radiogroup" aria-label="기록 종류">{([['ALL', `전체 ${volink.length + ext.length}`], ['VOLINK', `Volink ${volink.length}`], ['EXT', `1365 ${ext.length}`]] as const).map(([k, label]) =>
            <button key={k} type="button" role="radio" aria-checked={reviewTab === k} className={reviewTab === k ? 'on' : ''} onClick={() => setReviewTab(k)}>{label}</button>)}</div>
          <div className="c-picks">{list.slice(0, 3).map(row)}{!list.length && <p className="m-help">이 종류의 기록이 없어요.</p>}</div>
          {list.length > 3 && <button type="button" className="c-all" onClick={() => setReviewAll(true)}>전체보기 {list.length}<MIcon name="chevron" size={15} /></button>}
          {reviewAll && <Sheet title="후기를 쓸 기록" onClose={() => setReviewAll(false)}><div className="c-picks">{list.map(row)}</div></Sheet>}
          {errors.activityId && <span className="m-err">{errors.activityId}</span>}</div>
      })()
        : <div className="m-note"><strong>아직 후기를 쓸 수 있는 활동이 없어요</strong>Volink 활동을 마치거나, 1365 활동을 ‘다녀왔어요’로 남기면 후기를 쓸 수 있어요.</div>)}
      {!editId && category === 'PROMO' && (!promotable ? <Loading /> : promotable.length ? <div className="m-field"><div className="c-pick-head"><span className="m-label">홍보할 내 모집글</span>
        {promotable.length > 1 && <button type="button" className="c-all" onClick={() => setPromoAll(true)}>전체보기 {promotable.length}<MIcon name="chevron" size={15} /></button>}</div>
        {(() => { const a = promotable.find(x => x.id === promoPick) ?? promotable[0]
          return <div className="c-picks"><div className="c-pick on"><span className="c-dot" /><span><b>{a.title}</b><small>{dayWord(a.date)} {a.startTime} · 확정 {a.confirmed}/{a.capacity}명</small></span></div></div> })()}
        {promoAll && <Sheet title="내 모집글" onClose={() => setPromoAll(false)}><div className="c-picks">{promotable.map(a =>
          <button type="button" key={a.id} className={'c-pick' + (promoPick === a.id ? ' on' : '')} aria-pressed={promoPick === a.id} onClick={() => { setPromoPick(a.id); setPromoAll(false) }}>
            <span className="c-dot" /><span><b>{a.title}</b><small>{dayWord(a.date)} {a.startTime} · 확정 {a.confirmed}/{a.capacity}명</small></span></button>)}</div></Sheet>}
        {errors.activityId && <span className="m-err">{errors.activityId}</span>}</div>
        : <div className="m-note"><strong>홍보할 모집글이 없어요</strong>모집 중인 내 활동이 있어야 홍보할 수 있어요. <a className="c-inline-link" href="#/host">모집하러 가기 →</a></div>)}
      <label className="m-field"><span className="m-label">제목</span>
        <TextInput name="title" className={'m-input' + (errors.title ? ' bad' : '')} maxLength={60} placeholder="제목을 입력해 주세요" value={title} onChange={event => setTitle(event.target.value)} enterKeyHint="next" />
        <span className="m-count">{title.trim().length} / 60</span>{errors.title && <span className="m-err">{errors.title}</span>}</label>
      <label className="m-field"><span className="m-label">내용</span>
        <TextArea name="body" className={'m-input' + (errors.body ? ' bad' : '')} rows={8} maxLength={2000} placeholder={bodyHint[category]} value={body} onChange={event => setBody(event.target.value)} />
        <span className="m-count">{body.trim().length.toLocaleString()} / 2,000</span>{errors.body && <span className="m-err">{errors.body}</span>}</label>
      {looksLikeMeetup && <div className="m-note warm"><strong>같이 할 사람을 찾고 있나요?</strong>모집으로 열면 안전 검토와 출석 확인을 받을 수 있고, 연락처를 주고받지 않아도 돼요. <a className="c-inline-link" href="#/host">모집하러 가기 →</a></div>}
      <p className="c-safe"><MIcon name="alert" size={17} />개인 연락처와 민감한 정보는 공유하지 마세요.</p>
      {errors.form && <div className="m-note bad">{errors.form}</div>}
      <ActionBar><button className="m-btn" disabled={busy || (!editId && category === 'REVIEW' && !canReview)}>{busy ? '올리는 중…' : editId ? '수정 저장하기' : '게시글 등록하기'}</button></ActionBar>
    </form>
    {menu === 'menu' && <Sheet title="글쓰기 메뉴" onClose={() => setMenu(null)}><nav className="c-menu">
      {!editId && <button type="button" disabled={!dirty} onClick={saveDraft}><MIcon name="bookmark" size={20} /><span>임시 저장<small>{savedAt ? `마지막 저장 ${savedAt} · 쓰는 동안에도 자동으로 저장돼요` : '쓰는 동안에도 자동으로 저장돼요'}</small></span></button>}
      <button type="button" disabled={!dirty} onClick={() => setMenu('preview')}><MIcon name="eye" size={20} /><span>미리보기<small>올렸을 때 보이는 모습</small></span></button>
      <button type="button" disabled={!dirty} onClick={() => setMenu('reset')}><MIcon name="refresh" size={20} /><span>{editId ? '처음 내용으로 되돌리기' : '처음부터 다시 쓰기'}<small>{editId ? '고친 내용을 버려요' : '제목·내용과 임시 저장을 비워요'}</small></span></button>
      <button type="button" onClick={() => setMenu('rules')}><MIcon name="book" size={20} /><span>커뮤니티 이용 규칙<small>올리기 전에 한 번 확인해요</small></span></button>
    </nav></Sheet>}
    {menu === 'preview' && <Sheet title="미리보기" onClose={() => setMenu(null)} footer={<button type="button" className="m-btn" disabled={busy || !ready} onClick={() => { setMenu(null); void submit() }}>{editId ? '이대로 저장하기' : '이대로 올리기'}</button>}>
      <article className="c-preview"><span className="m-badge gray">{categoryLabel[category]}</span><h3>{title.trim() || '(제목 없음)'}</h3><p>{body.trim() || '(내용 없음)'}</p>
        {(promoActivity || reviewTitle) && <div className="c-preview-card"><MIcon name={promoActivity ? 'megaphone' : 'record'} size={17} /><span>{promoActivity ? `${promoActivity.title} · [바로 신청하기]` : `함께한 봉사 · ${reviewTitle}`}</span></div>}</article>
      {!ready && <p className="m-help">제목 2자, 내용 5자 이상이어야 올릴 수 있어요.</p>}
    </Sheet>}
    {menu === 'reset' && <Sheet title={editId ? '처음 내용으로 되돌릴까요?' : '처음부터 다시 쓸까요?'} onClose={() => setMenu(null)}
      footer={<div className="m-two"><button type="button" className="m-btn line" onClick={() => setMenu(null)}>계속 쓰기</button><button type="button" className="m-btn danger" onClick={reset}>{editId ? '되돌리기' : '비우기'}</button></div>}>
      <p className="m-help">{editId ? '지금까지 고친 내용이 사라져요.' : '지금 쓴 제목·내용과 임시 저장한 글이 사라져요.'}</p></Sheet>}
    {menu === 'rules' && <Sheet title="커뮤니티 이용 규칙" onClose={() => setMenu(null)}><ul className="m-bullets">
      <li>전화번호·카톡 아이디 같은 <b>연락처는 올릴 수 없어요.</b> 소식·질문으로 이야기해요.</li>
      <li>사진 속 다른 사람의 얼굴·이름은 가려 주세요.</li>
      <li>같이 할 사람을 찾을 땐 글 대신 <b>모집</b>으로 열어 주세요(안전 검토·출석 확인).</li>
      <li>광고·비방·개인 정보 노출 글은 내려갈 수 있어요.</li>
    </ul></Sheet>}
    {gate && <Sheet title={gate === 'review' ? '끝낸 봉사가 있어야 후기를 쓸 수 있어요' : gate === 'promoted' ? '모집 중인 활동은 모두 홍보했어요' : gate === 'reviewing' ? '검토가 끝나면 홍보할 수 있어요' : '모집 중인 내 활동이 있어야 해요'}
      onClose={() => setGate(null)} footer={<>
        {gate === 'review' && <><a className="m-btn" href="#/find">봉사 찾아보기</a><a className="m-btn line" href="#/records?kind=1365">1365 기록 넣기</a></>}
        {gate === 'promo' && <a className="m-btn" href="#/host">봉사 모집 만들기</a>}
        {gate === 'promoted' && (() => { const done = promoList?.find(a => a.promoPostId); return done ? <a className="m-btn" href={'#/post/' + done.promoPostId}>그 글 보기</a> : null })()}
        <button type="button" className="m-text-btn" onClick={() => { setGate(null); setCategory('FREE') }}>자유 글로 쓸게요</button></>}>
      <p className="m-help">{gate === 'review' ? 'Volink에서 참여·모집을 마쳤거나 1365 기록이 있으면 돼요.' : gate === 'promoted' ? '활동 하나에 한 번 홍보할 수 있어요.' : gate === 'reviewing' ? '안전 검토가 끝나고 공개되면 홍보 글을 쓸 수 있어요.' : '내가 연 봉사 모집을 소개하는 글이에요. 활동 하나에 한 번 홍보할 수 있어요.'}</p>
      {gate === 'promoted' && promoList?.find(a => a.promoPostId) && <div className="m-summary"><strong>{promoList.find(a => a.promoPostId)!.promoTitle}</strong><span>{promoList.find(a => a.promoPostId)!.title}</span></div>}
    </Sheet>}
    {leaving && <Sheet title="작성 중인 글을 버릴까요?" onClose={() => setLeaving(false)} footer={<div className="c-leave">
      {!editId && <button type="button" className="m-btn" onClick={() => { setLeaving(false); goBack('#/community') }}>임시 저장하고 나가기</button>}
      <button type="button" className="m-btn line danger-text" onClick={() => { if (!editId) writeDraft(null); setLeaving(false); goBack('#/community') }}>{editId ? '고친 내용 버리기' : '버리기'}</button>
      <button type="button" className="m-btn line" onClick={() => setLeaving(false)}>계속 쓰기</button></div>}>
      <p className="m-help">{editId ? '나가면 고친 내용은 저장되지 않아요.' : '임시 저장하면 다음에 글쓰기를 열 때 이어서 쓸 수 있어요.'}</p>
    </Sheet>}
  </div>
}
