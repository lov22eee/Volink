// 커뮤니티 (bottom tab): 자유 · 질문 · 봉사후기. Reviews are tied to an activity the writer completed ("참여 확인").
// Names are partly hidden; contact details are refused by the server. No example posts: an empty board says so.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, ApiError } from '../api'
import type { LiveActivity } from '../api'
import { friendlyTime, showToast } from '../App'
import type { ExternalRecord } from './record'
import { ActionBar, dayWord, Empty, go, goBack, Loading, MIcon, Sheet, TopBar, TextArea, TextInput } from './ui'

type Category = 'FREE' | 'QUESTION' | 'REVIEW' | 'PROMO'
export type PostSummary = { id: number; category: Category; title: string; preview: string; author: string; mine: boolean; createdAt: string; likes: number; comments: number; liked: boolean; verified: boolean; activityId: number | null; activityTitle: string | null; activityDate: string | null; activityCategory?: string | null; edited?: boolean
  /** 봉사 홍보 (PROMO): the live activity card. */
  activityTime?: string | null; activityPlace?: string | null; activityCapacity?: number | null; activityConfirmed?: number | null; activityOpen?: boolean
  /** 1365 review (V27): the person's own record — 본인 기록, or 실적확인서 있음. */
  externalId?: number | null; externalTitle?: string | null; externalDate?: string | null; externalCertified?: boolean | null }
type Comment = { id: number; body: string; author: string; mine: boolean; organizer: boolean; postAuthor: boolean; createdAt: string; edited?: boolean }
type Post = Omit<PostSummary, 'preview'> & { body: string; comments: Comment[] }
type Reviewable = { id: number; title: string; date: string; durationMinutes: number }

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
      {post.verified && <span className="c-verified"><MIcon name="check" size={14} />참여 확인</span>}
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
  const left = Math.max(0, (post.activityCapacity ?? 0) - (post.activityConfirmed ?? 0))
  const open = Boolean(post.activityOpen)
  const go = (event: React.MouseEvent) => { event.preventDefault(); event.stopPropagation(); window.location.hash = '#/activity/' + post.activityId }
  return <span className={'c-promo' + (big ? ' big' : '') + (open ? '' : ' closed')} role="group" aria-label="연결된 봉사 모집">
    <small>연결된 봉사 모집{post.activityCategory ? ' · ' + post.activityCategory : ''}</small>
    <b>{post.activityTitle}</b>
    <span>{[dateText(post.activityDate), post.activityTime, post.activityPlace].filter(Boolean).join(' · ')}</span>
    <span className="c-promo-foot"><em>{open ? (left > 0 ? `${left}자리 남음` : '정원 마감 · 대기 신청 가능') : '모집 마감'}</em>
      <button type="button" disabled={!open} onClick={go}>{open ? '바로 신청하기' : '모집 마감'}{open && <MIcon name="chevron" size={15} />}</button></span>
  </span>
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

export function CommunityScreen({ actions }: { actions: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined)
  useEffect(() => { api<Profile>('/api/community/me').then(setProfile).catch(() => setProfile(null)) }, [])
  if (profile === undefined) return <div className="m-screen"><TopBar title="커뮤니티" actions={actions} /><Loading /></div>
  if (!profile?.ready) return <CommunityOnboarding profile={profile ?? null} onDone={setProfile} />
  return <CommunityBoard actions={actions} />
}

function CommunityBoard({ actions }: { actions: ReactNode }) {
  const [category, setCategory] = useState<Category | ''>('')
  const [sort, setSort] = useState<'latest' | 'popular'>('latest')
  const [items, setItems] = useState<PostSummary[] | null>(null)
  useEffect(() => {
    let current = true
    setItems(null)
    const params = new URLSearchParams({ sort })
    if (category) params.set('category', category)
    api<PostSummary[]>('/api/community/posts?' + params).then(list => { if (current) setItems(list) }).catch(() => { if (current) setItems([]) })
    return () => { current = false }
  }, [category, sort])
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
  const [promotable, setPromotable] = useState<LiveActivity[] | null>(null)
  const [promoPick, setPromoPick] = useState<number | null>(initial === 'PROMO' ? activity ?? null : null)
  const [promoAll, setPromoAll] = useState(false)
  useEffect(() => {
    if (editId || category !== 'PROMO' || promotable) return
    api<LiveActivity[]>('/api/me/activities').then(list => {
      // Newest recruitment first (2026-11-06): one card shown, the rest behind 전체보기.
      const open = list.filter(a => a.status === 'RECRUITING' && new Date(`${a.date}T${a.startTime}:00+09:00`).getTime() > Date.now()).sort((a, b) => b.id - a.id)
      setPromotable(open)
      setPromoPick(current => current ?? open[0]?.id ?? null)
    }).catch(() => setPromotable([]))
  }, [category, editId, promotable])
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
  const [loaded, setLoaded] = useState(!editId)
  useEffect(() => { if (saved && (saved.title || saved.body)) showToast('작성 중이던 글을 불러왔어요') }, [saved])
  useEffect(() => {
    if (editId) { api<Post>('/api/community/posts/' + editId).then(p => { setCategory(p.category); setTitle(p.title); setBody(p.body); setLoaded(true) }).catch(() => { showToast('글을 불러오지 못했어요'); go('#/community') }); return }
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
  if (!loaded) return <div className="m-screen"><TopBar title="글 수정" back="history" /><Loading /></div>
  return <div className="m-screen m-create c-write">
    <TopBar title={editId ? '글 수정' : '글쓰기'} back={() => dirty ? setLeaving(true) : goBack('#/community')}
      actions={<button type="button" className="c-post-btn" disabled={busy || !ready} onClick={() => submit()}>{editId ? '저장' : '등록'}</button>} />
    <form className="m-body m-form" onSubmit={submit} noValidate>
      {!editId && <div className="m-field"><span className="m-label">어떤 이야기를 나눌까요?</span><div className="c-kinds">{order.map(c =>
        <button type="button" key={c} className={'m-chip' + (category === c ? ' on' : '')} aria-pressed={category === c} onClick={() => setCategory(c)}>{categoryLabel[c]}</button>)}</div></div>}
      {!editId && category === 'REVIEW' && (!reviewable ? <Loading /> : canReview ? <div className="m-field"><span className="m-label">내 완료 기록에서 골라 주세요</span>
        <div className="c-picks">{reviewable.slice(0, 4).map(a => <button type="button" key={a.id} className={'c-pick' + (!pickedExt && picked === a.id ? ' on' : '')} aria-pressed={!pickedExt && picked === a.id} onClick={() => { setPicked(a.id); setPickedExt(null) }}>
          <span className="c-dot" /><span><b>{a.title}</b><small>{dayWord(a.date)} 참여 완료</small></span></button>)}
          {extList.slice(0, 4).map(r => <button type="button" key={'e' + r.id} className={'c-pick' + (pickedExt === r.id ? ' on' : '')} aria-pressed={pickedExt === r.id} onClick={() => setPickedExt(r.id)}>
            <span className="c-dot" /><span><b><em className="c-1365">1365</em>{r.title}</b><small>{dayWord(r.date)} · {r.certified ? '실적확인서 있음' : '본인 기록'}</small></span></button>)}</div>
        {errors.activityId && <span className="m-err">{errors.activityId}</span>}</div>
        : <div className="m-note"><strong>아직 후기를 쓸 수 있는 활동이 없어요</strong>Volink 활동을 완료하거나, 1365 활동을 ‘다녀왔어요’로 남기면 후기를 쓸 수 있어요.</div>)}
      {!editId && category === 'PROMO' && (!promotable ? <Loading /> : promotable.length ? <div className="m-field"><div className="c-pick-head"><span className="m-label">홍보할 내 모집글</span>
        {promotable.length > 1 && <button type="button" className="c-all" onClick={() => setPromoAll(true)}>전체보기 {promotable.length}<MIcon name="chevron" size={15} /></button>}</div>
        {(() => { const a = promotable.find(x => x.id === promoPick) ?? promotable[0]
          return <div className="c-picks"><div className="c-pick on"><span className="c-dot" /><span><b>{a.title}</b><small>{dayWord(a.date)} {a.startTime} · 확정 {a.confirmed}/{a.capacity}명</small></span></div></div> })()}
        <p className="m-help">글 아래에 이 모집글 카드와 [바로 신청하기]가 붙어요. 활동 하나에 한 번만 홍보할 수 있어요.</p>
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
    {leaving && <Sheet title="작성 중인 글을 버릴까요?" onClose={() => setLeaving(false)} footer={<div className="c-leave">
      {!editId && <button type="button" className="m-btn" onClick={() => { setLeaving(false); goBack('#/community') }}>임시 저장하고 나가기</button>}
      <button type="button" className="m-btn line danger-text" onClick={() => { if (!editId) writeDraft(null); setLeaving(false); goBack('#/community') }}>{editId ? '고친 내용 버리기' : '버리기'}</button>
      <button type="button" className="m-btn line" onClick={() => setLeaving(false)}>계속 쓰기</button></div>}>
      <p className="m-help">{editId ? '나가면 고친 내용은 저장되지 않아요.' : '임시 저장하면 다음에 글쓰기를 열 때 이어서 쓸 수 있어요.'}</p>
    </Sheet>}
  </div>
}
