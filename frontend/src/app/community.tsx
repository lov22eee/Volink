// 커뮤니티 (bottom tab): 자유 · 질문 · 봉사후기. Reviews are tied to an activity the writer completed ("참여 확인").
// Names are partly hidden; contact details are refused by the server. No example posts: an empty board says so.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { api, ApiError } from '../api'
import { friendlyTime, showToast } from '../App'
import { ActionBar, dayWord, Empty, go, Loading, MIcon, Sheet, TopBar } from './ui'

type Category = 'FREE' | 'QUESTION' | 'REVIEW'
export type PostSummary = { id: number; category: Category; title: string; preview: string; author: string; mine: boolean; createdAt: string; likes: number; comments: number; liked: boolean; verified: boolean; activityId: number | null; activityTitle: string | null; activityDate: string | null }
type Comment = { id: number; body: string; author: string; mine: boolean; organizer: boolean; postAuthor: boolean; createdAt: string }
type Post = Omit<PostSummary, 'preview'> & { body: string; comments: Comment[] }
type Reviewable = { id: number; title: string; date: string; durationMinutes: number }

export const categoryLabel: Record<Category, string> = { FREE: '자유', QUESTION: '질문', REVIEW: '봉사후기' }
const order: Category[] = ['FREE', 'QUESTION', 'REVIEW']
// The server sends "yyyy-MM-ddTHH:mm"; friendlyTime reads "yyyy-MM-dd HH:mm".
const ago = (value: string) => friendlyTime(value.replace('T', ' '))
const shortDate = (date: string) => Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10))
// "같이 할 분 구해요" kind of posts belong in 모집 (safety review, no contact exchange).
const meetup = /(같이|함께).{0,12}(하실|할|가실|갈|하실래|해요|모여)|(구해요|구합니다|모여요|모집해요|모집합니다|만나요)/

function PostCard({ post }: { post: PostSummary }) {
  return <a className="c-card" href={'#/post/' + post.id}>
    <div className="c-card-top"><span className={'m-badge ' + (post.category === 'REVIEW' ? 'mint' : 'gray')}>{categoryLabel[post.category]}</span>
      {post.verified && <span className="c-verified"><MIcon name="check" size={14} />참여 확인</span>}
      <small>{ago(post.createdAt)} · {post.author}{post.mine ? ' (나)' : ''}</small></div>
    <strong>{post.title}</strong>
    <p>{post.preview}</p>
    {post.activityTitle && <span className="c-act"><MIcon name="leaf" size={15} />{post.activityTitle}</span>}
    <div className="c-foot"><span className={post.liked ? 'on' : ''}><MIcon name="heart" size={17} />{post.likes}</span><span><MIcon name="chat" size={17} />{post.comments}</span></div>
  </a>
}

type Profile = { nickname: string | null; agreed: boolean; ready: boolean; nextChange: string | null }
const adjectives = ['따뜻한', '부지런한', '다정한', '씩씩한', '포근한', '반짝이는', '느긋한', '상냥한', '든든한', '싱그러운', '활짝 핀', '산뜻한']
const nouns = ['자몽', '도토리', '민들레', '해바라기', '참새', '새싹', '고구마', '귤', '다람쥐', '토끼', '소나무', '구름']
const randomNickname = () => adjectives[Math.floor(Math.random() * adjectives.length)] + ' ' + nouns[Math.floor(Math.random() * nouns.length)]
const rules = ['전화번호·이메일·오픈채팅 같은 연락처를 올리지 않아요.', '다른 사람을 비방하거나 차별하는 글을 쓰지 않아요.', '광고·홍보·모금 글을 올리지 않아요.', '같이 활동할 사람은 커뮤니티가 아니라 ‘모집’으로 구해요.', '규칙을 어긴 글은 지워지고 이용이 제한될 수 있어요.']

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
      <span className="m-input with-peek"><input aria-label="닉네임" maxLength={CommunityNick.max} value={nickname} onChange={event => { setNickname(event.target.value); setError('') }} enterKeyHint="done" />
        <button type="button" className="m-peek" aria-label="닉네임 새로 추천받기" onClick={() => { setNickname(randomNickname()); setError('') }}><MIcon name="refresh" size={20} /></button></span>
      <span className="m-help">돌림 버튼을 누르면 새 닉네임을 추천해 드려요. 바꾸기는 30일에 한 번이에요.{profile?.nextChange && change ? ` (${profile.nextChange.slice(5).replace('-', '/')}부터)` : ''}</span></label>
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
    <form className="c-nick" onSubmit={event => { event.preventDefault(); if (valid) { (document.activeElement as HTMLElement | null)?.blur(); setRulesOpen(true) } }} noValidate aria-hidden={stage === 'hello'}>
      <label className="m-field"><span className="m-label">닉네임 <small>{CommunityNick.min}~{CommunityNick.max}자 · 한글·영문·숫자</small></span>
        <span className={'m-input with-peek' + (error && !rulesOpen ? ' bad' : '')}><input aria-label="닉네임" maxLength={CommunityNick.max} value={nickname} tabIndex={stage === 'hello' ? -1 : 0}
          onChange={event => { setNickname(event.target.value); setError('') }} enterKeyHint="next" />
          <button type="button" className="m-peek" aria-label="닉네임 새로 추천받기" tabIndex={stage === 'hello' ? -1 : 0} onClick={() => { setNickname(randomNickname()); setError('') }}><MIcon name="refresh" size={20} /></button></span>
        <span className="m-help">돌림 버튼으로 새 닉네임을 추천받을 수 있어요. 바꾸기는 30일에 한 번이에요.</span>
        {error && !rulesOpen && <span className="m-err" role="alert">{error}</span>}</label>
      <ActionBar><button className="m-btn" disabled={!valid || stage === 'hello'} tabIndex={stage === 'hello' ? -1 : 0}>다음</button></ActionBar>
    </form>
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
  return <CommunityBoard actions={actions} nickname={profile.nickname ?? ''} />
}

function CommunityBoard({ actions, nickname }: { actions: ReactNode; nickname: string }) {
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
      <section className="c-banner"><strong><MIcon name="sprout" size={20} />함께하는 봉사 이야기</strong><span>궁금한 건 묻고, 따뜻한 경험은 나눠요. 나는 <b>{nickname}</b></span></section>
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

export function PostScreen({ id, onChange }: { id: number; onChange: () => void }) {
  const [post, setPost] = useState<Post | null>(null)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => api<Post>('/api/community/posts/' + id).then(setPost).catch(() => setFailed(true)), [id])
  useEffect(() => { load() }, [load])
  if (failed) return <div className="m-screen"><TopBar title="게시글" back="#/community" /><div className="m-body"><Empty icon="chat" title="글을 찾을 수 없어요" text="지워졌을 수 있어요." action={<a className="m-btn sm" href="#/community">커뮤니티로</a>} /></div></div>
  if (!post) return <div className="m-screen"><TopBar title="게시글" back="history" /><Loading /></div>
  async function like() {
    if (!post) return
    try {
      const result = await api<{ liked: boolean; likes: number }>('/api/community/posts/' + id + '/like', post.liked ? 'DELETE' : 'PUT')
      setPost({ ...post, liked: result.liked, likes: result.likes })
    } catch { showToast('처리하지 못했어요') }
  }
  async function comment(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      setPost(await api<Post>('/api/community/posts/' + id + '/comments', 'POST', { body: text }))
      setText('')
      onChange()
    } catch (cause) {
      setError(cause instanceof ApiError ? (cause.fieldErrors.body ?? cause.message) : '댓글을 달지 못했어요.')
    } finally {
      setBusy(false)
    }
  }
  async function remove(path: string, done: string, after: () => void) {
    try { await api(path, 'DELETE'); showToast(done); after() } catch { showToast('지우지 못했어요') }
  }
  return <div className="m-screen c-post">
    <TopBar title="게시글" back="history" actions={post.mine ? <button type="button" className="m-icon-btn" aria-label="글 메뉴" onClick={() => setMenu(true)}><MIcon name="more" /></button> : undefined} />
    <div className="m-body">
      <article className="c-article">
        <div className="c-card-top"><span className={'m-badge ' + (post.category === 'REVIEW' ? 'mint' : 'gray')}>{categoryLabel[post.category]}</span>
          {post.verified && <span className="c-verified"><MIcon name="check" size={14} />Volink 참여 확인</span>}</div>
        <h1>{post.title}</h1>
        <div className="c-author"><span className="m-avatar sm"><MIcon name="user" size={17} /></span><span><b>{post.author}{post.mine ? ' (나)' : ''}</b><small>{ago(post.createdAt)}</small></span></div>
        <p className="c-body">{post.body}</p>
        {post.activityId && <a className="c-linked" href={'#/activity/' + post.activityId}><span><MIcon name="calendar" size={18} /><b>연결된 봉사활동</b></span>
          <strong>{post.activityTitle}</strong><small>활동일 {post.activityDate ? shortDate(post.activityDate) : ''}</small><em>봉사 상세보기 <MIcon name="chevron" size={15} /></em></a>}
        <div className="c-actions"><button type="button" className={'m-btn line sm' + (post.liked ? ' liked' : '')} aria-pressed={post.liked} onClick={like}><MIcon name={post.liked ? 'heart' : 'heart'} size={19} />좋아요 {post.likes}</button></div>
      </article>
      <section className="c-comments" aria-label="댓글"><h2>댓글 {post.comments.length}</h2>
        {post.comments.length === 0 ? <p className="m-help">첫 댓글을 남겨 보세요.</p> : <ul>{post.comments.map(c => <li key={c.id}>
          <span className="m-avatar sm"><MIcon name="user" size={16} /></span>
          <div><b>{c.author}{c.mine ? ' (나)' : ''}{c.organizer && <span className="m-badge mint">모집자</span>}{c.postAuthor && !c.organizer && <span className="m-badge gray">글쓴이</span>}</b><p>{c.body}</p><small>{ago(c.createdAt)}</small></div>
          {c.mine && <button type="button" className="m-text-btn" onClick={() => remove('/api/community/comments/' + c.id, '댓글을 지웠어요', load)}>지우기</button>}
        </li>)}</ul>}
      </section>
    </div>
    <form className="c-reply" onSubmit={comment}>
      {error && <p className="m-err" role="alert">{error}</p>}
      <div><input className="m-input" aria-label="댓글 내용" placeholder="댓글 달기" maxLength={500} value={text} onChange={event => { setText(event.target.value); setError('') }} enterKeyHint="send" />
        <button className="c-send" aria-label="댓글 보내기" disabled={busy || !text.trim()}><MIcon name="send" size={20} /></button></div>
    </form>
    {menu && <Sheet title="글 메뉴" onClose={() => setMenu(false)}>
      <nav className="m-menu flat"><button type="button" className="danger" onClick={() => remove('/api/community/posts/' + id, '글을 지웠어요', () => go('#/community'))}><MIcon name="trash" size={20} /><span>글 지우기</span><MIcon name="chevron" size={18} /></button></nav>
    </Sheet>}
  </div>
}

export function WriteScreen({ initial, activity }: { initial?: string; activity?: number }) {
  const [category, setCategory] = useState<Category>(initial === 'QUESTION' || initial === 'REVIEW' ? initial : activity ? 'REVIEW' : 'FREE')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [picked, setPicked] = useState<number | null>(activity ?? null)
  const [reviewable, setReviewable] = useState<Reviewable[] | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Reviewable[]>('/api/community/reviewable').then(list => { setReviewable(list); if (!activity && list[0]) setPicked(list[0].id) }).catch(() => setReviewable([])) }, [activity])
  const looksLikeMeetup = useMemo(() => category !== 'REVIEW' && meetup.test(title + ' ' + body), [category, title, body])
  const canReview = (reviewable?.length ?? 0) > 0
  async function submit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (title.trim().length < 2) found.title = '제목은 2자 이상 적어 주세요.'
    if (body.trim().length < 5) found.body = '내용은 5자 이상 적어 주세요.'
    if (category === 'REVIEW' && !picked) found.activityId = '후기를 남길 활동을 골라 주세요.'
    setErrors(found)
    if (Object.keys(found).length) return
    setBusy(true)
    try {
      const post = await api<Post>('/api/community/posts', 'POST', { category, title, body, activityId: category === 'REVIEW' ? picked : null })
      showToast('글을 올렸어요')
      window.location.replace('#/post/' + post.id)
    } catch (cause) {
      if (cause instanceof ApiError && Object.keys(cause.fieldErrors).length) setErrors(cause.fieldErrors)
      else setErrors({ form: cause instanceof Error ? cause.message : '올리지 못했어요.' })
    } finally {
      setBusy(false)
    }
  }
  return <div className="m-screen m-create">
    <TopBar title="글쓰기" back="history" />
    <form className="m-body m-form" onSubmit={submit} noValidate>
      <div className="m-field"><span className="m-label">글 종류</span><div className="m-seg wide">{order.map(c =>
        <button type="button" key={c} className={category === c ? 'on' : ''} aria-pressed={category === c} onClick={() => setCategory(c)}>{categoryLabel[c]}</button>)}</div></div>
      {category === 'REVIEW' && (!reviewable ? <Loading /> : canReview ? <div className="m-field"><span className="m-label">어떤 활동 후기인가요?</span>
        <div className="c-picks">{reviewable.slice(0, 4).map(a => <button type="button" key={a.id} className={'c-pick' + (picked === a.id ? ' on' : '')} aria-pressed={picked === a.id} onClick={() => setPicked(a.id)}>
          <span className="c-dot" /><span><b>{a.title}</b><small>{dayWord(a.date)} 완료</small></span></button>)}</div>
        {errors.activityId && <span className="m-err">{errors.activityId}</span>}</div>
        : <div className="m-note"><strong>아직 후기를 쓸 수 있는 활동이 없어요</strong>Volink 활동에 참여하고 완료 확인을 받으면 ‘참여 확인’ 후기를 남길 수 있어요.</div>)}
      <label className="m-field"><span className="m-label">제목</span>
        <input name="title" className={'m-input' + (errors.title ? ' bad' : '')} maxLength={60} placeholder={category === 'REVIEW' ? '예: 호수공원 플로깅 다녀왔어요' : category === 'QUESTION' ? '예: 첫 봉사인데 준비물이 있을까요?' : '예: 플로깅엔 코팅 장갑이 편해요'}
          value={title} onChange={event => setTitle(event.target.value)} enterKeyHint="next" />
        <span className="m-count">{title.trim().length} / 60</span>{errors.title && <span className="m-err">{errors.title}</span>}</label>
      <label className="m-field"><span className="m-label">내용</span>
        <textarea name="body" className={'m-input' + (errors.body ? ' bad' : '')} rows={7} maxLength={2000} placeholder="이웃에게 나누고 싶은 이야기를 적어 주세요." value={body} onChange={event => setBody(event.target.value)} />
        <span className="m-count">{body.trim().length} / 2000</span>{errors.body && <span className="m-err">{errors.body}</span>}</label>
      {looksLikeMeetup && <div className="m-note warm"><strong>같이 할 사람을 찾고 있나요?</strong>모집으로 열면 안전 검토와 출석 확인을 받을 수 있고, 연락처를 주고받지 않아도 돼요. <a className="c-inline-link" href="#/host">모집하러 가기 →</a></div>}
      <p className="m-help">전화번호·이메일·오픈채팅은 올릴 수 없어요. 글에는 내 커뮤니티 닉네임이 보여요.</p>
      {errors.form && <div className="m-note bad">{errors.form}</div>}
      <ActionBar><button className="m-btn" disabled={busy || (category === 'REVIEW' && !canReview)}>{busy ? '올리는 중…' : '올리기'}</button></ActionBar>
    </form>
  </div>
}
