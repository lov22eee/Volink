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
      <small>{ago(post.createdAt)} · {post.mine ? '나' : post.author}</small></div>
    <strong>{post.title}</strong>
    <p>{post.preview}</p>
    {post.activityTitle && <span className="c-act"><MIcon name="leaf" size={15} />{post.activityTitle}</span>}
    <div className="c-foot"><span className={post.liked ? 'on' : ''}><MIcon name="heart" size={17} />{post.likes}</span><span><MIcon name="chat" size={17} />{post.comments}</span></div>
  </a>
}

export function CommunityScreen({ actions }: { actions: ReactNode }) {
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
        <div className="m-seg" role="tablist" aria-label="정렬">
          <button role="tab" aria-selected={sort === 'latest'} className={sort === 'latest' ? 'on' : ''} onClick={() => setSort('latest')}>최신순</button>
          <button role="tab" aria-selected={sort === 'popular'} className={sort === 'popular' ? 'on' : ''} onClick={() => setSort('popular')}>인기순</button></div></div>
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
        <div className="c-author"><span className="m-avatar sm"><MIcon name="user" size={17} /></span><span><b>{post.mine ? '나' : post.author}</b><small>{ago(post.createdAt)}</small></span></div>
        <p className="c-body">{post.body}</p>
        {post.activityId && <a className="c-linked" href={'#/activity/' + post.activityId}><span><MIcon name="calendar" size={18} /><b>연결된 봉사활동</b></span>
          <strong>{post.activityTitle}</strong><small>활동일 {post.activityDate ? shortDate(post.activityDate) : ''}</small><em>봉사 상세보기 <MIcon name="chevron" size={15} /></em></a>}
        <div className="c-actions"><button type="button" className={'m-btn line sm' + (post.liked ? ' liked' : '')} aria-pressed={post.liked} onClick={like}><MIcon name={post.liked ? 'heart' : 'heart'} size={19} />좋아요 {post.likes}</button></div>
      </article>
      <section className="c-comments" aria-label="댓글"><h2>댓글 {post.comments.length}</h2>
        {post.comments.length === 0 ? <p className="m-help">첫 댓글을 남겨 보세요.</p> : <ul>{post.comments.map(c => <li key={c.id}>
          <span className="m-avatar sm"><MIcon name="user" size={16} /></span>
          <div><b>{c.mine ? '나' : c.author}{c.organizer && <span className="m-badge mint">모집자</span>}{c.postAuthor && !c.organizer && <span className="m-badge gray">글쓴이</span>}</b><p>{c.body}</p><small>{ago(c.createdAt)}</small></div>
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
      <p className="m-help">전화번호·이메일·오픈채팅은 올릴 수 없어요. 이름은 가운데를 가려서 보여요.</p>
      {errors.form && <div className="m-note bad">{errors.form}</div>}
      <ActionBar><button className="m-btn" disabled={busy || (category === 'REVIEW' && !canReview)}>{busy ? '올리는 중…' : '올리기'}</button></ActionBar>
    </form>
  </div>
}
