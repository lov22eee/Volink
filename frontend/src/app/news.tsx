// 활동 소식 for the app (2026-11-05): its own screen, reached from an entry card on the activity and from notifications.
// Participant: the latest notice pinned on top, questions and answers as chat bubbles, a fixed input at the bottom
// (a question can be for the organizer only). Organizer: 공지 / 질문 tabs, ready-made notice sentences, quick replies,
// and how many confirmed people opened the news after each notice. Same server rules as the web (no contact details).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from '../api'
import type { LiveActivity, User } from '../api'
import { friendlyTime, showToast } from '../App'
import { dayWord, Loading, MIcon, Sheet, TopBar, TextArea } from './ui'

type Post = { id: number; kind: 'NOTICE' | 'QUESTION' | 'ANSWER'; body: string; createdAt: string; author: string; mine: boolean; private?: boolean; unseen?: boolean; readCount?: number; answer?: Post | null }
export type Thread = { canNotice: boolean; canAsk: boolean; canAnswer: boolean; unanswered: number; newNotices: number; newAnswers: number; audience: number; notices: Post[]; questions: Post[] }

const ago = (value: string) => friendlyTime(value.replace('T', ' '))
const message = (cause: unknown) => cause instanceof ApiError ? (cause.fieldErrors.body ?? cause.message) : '보내지 못했어요.'
/** Notification titles that belong to the news (the server links them to the activity). */
export const newsTitles = ['새 공지가 올라왔어요', '새 질문이 있어요', '모집자에게만 보이는 질문이 있어요', '질문에 답변이 달렸어요']

/** Card on the activity / dashboard: what is new, and the way into the news screen. */
export function NewsEntry({ activityId, organizer }: { activityId: number; organizer: boolean }) {
  const [thread, setThread] = useState<Thread | null>(null)
  useEffect(() => { api<Thread>('/api/activities/' + activityId + '/posts').then(setThread).catch(() => setThread(null)) }, [activityId])
  if (!thread) return null
  const fresh = organizer ? (thread.unanswered ? `답변할 질문 ${thread.unanswered}` : '') : [thread.newNotices ? `새 공지 ${thread.newNotices}` : '', thread.newAnswers ? `새 답변 ${thread.newAnswers}` : ''].filter(Boolean).join(' · ')
  return <a className="n-entry" href={'#/news/' + activityId}>
    <span className="n-entry-ico"><MIcon name="chat" size={22} />{fresh && <i />}</span>
    <span className="n-entry-main"><b>활동 소식</b><small>{fresh && <em>{fresh}</em>}{fresh && ' · '}공지 {thread.notices.length} · 질문 {thread.questions.length}</small></span>
    <MIcon name="chevron" size={18} />
  </a>
}

export function NewsScreen({ id, user }: { id: number; user: User }) {
  const [activity, setActivity] = useState<LiveActivity | null>(null)
  const [thread, setThread] = useState<Thread | null>(null)
  const [failed, setFailed] = useState('')
  const [tab, setTab] = useState<'notice' | 'question'>('notice')
  const [allNotices, setAllNotices] = useState(false)
  const [text, setText] = useState('')
  const [privately, setPrivately] = useState(false)
  const [answering, setAnswering] = useState<Post | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<Post | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  const load = useCallback(() => api<Thread>('/api/activities/' + id + '/posts').then(t => { setThread(t); return t }), [id])
  useEffect(() => {
    api<LiveActivity>('/api/activities/' + id).then(setActivity).catch(() => {})
    // Load first (so "new" marks show), then record that this person has seen everything up to now.
    load().then(() => api('/api/activities/' + id + '/posts/seen', 'POST').catch(() => {}))
      .catch(() => setFailed('확정된 참가자와 모집자만 볼 수 있어요.'))
  }, [id, load])
  const organizer = Boolean(activity && activity.organizerId === user.id)
  useEffect(() => { if (organizer && thread && thread.unanswered > 0) setTab('question') }, [organizer, thread?.unanswered]) // eslint-disable-line react-hooks/exhaustive-deps
  const questions = useMemo(() => [...(thread?.questions ?? [])].reverse(), [thread])

  async function send(event?: FormEvent) {
    event?.preventDefault()
    if (!text.trim() || !thread) return
    setBusy(true)
    setError('')
    try {
      if (answering) { await api('/api/activity-posts/' + answering.id + '/answer', 'POST', { body: text }); showToast('답변을 달았어요'); setAnswering(null) }
      else if (organizer) { await api('/api/activities/' + id + '/notices', 'POST', { body: text }); showToast('공지를 올렸어요', `확정된 ${thread.audience}명에게 알림이 가요`) }
      else { await api('/api/activities/' + id + '/questions', 'POST', { body: text, privately }); showToast(privately ? '모집자에게만 질문했어요' : '질문을 남겼어요') }
      setText('')
      setPrivately(false)
      await load()
      window.setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 80)
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  async function remove(post: Post) {
    try { await api('/api/activity-posts/' + post.id, 'DELETE'); showToast(post.kind === 'NOTICE' ? '공지를 지웠어요' : '질문을 지웠어요'); setRemoving(null); load() }
    catch (cause) { showToast(message(cause)) }
  }
  function fill(value: string) {
    setText(value)
    setError('')
    window.setTimeout(() => { input.current?.focus(); input.current?.setSelectionRange(value.length, value.length) }, 30)
  }

  const subtitle = activity ? `${activity.title} · ${dayWord(activity.date)} ${activity.startTime}` : ''
  const head = <TopBar title="활동 소식" back="history" />
  if (failed) return <div className="m-screen">{head}<div className="m-body"><div className="m-note bad">{failed}</div></div></div>
  if (!thread || !activity) return <div className="m-screen">{head}<Loading /></div>

  const meeting = activity.meetingPoint || activity.placeName || '만나는 곳'
  const own = (activity.supplies ?? []).filter(s => !s.provided).map(s => s.name), given = (activity.supplies ?? []).filter(s => s.provided).map(s => s.name)
  const templates: [string, string][] = [
    ['준비물 안내', `준비물 안내드려요. ${own.length ? '각자 챙길 것: ' + own.join(', ') + '. ' : ''}${given.length ? given.join(', ') + '은(는) 제가 준비해 갈게요. ' : ''}편한 신발로 와 주세요!`],
    ['집결 장소', `${meeting}에서 ${activity.startTime}에 만나요. 찾기 어려우면 여기에 질문 남겨 주세요.`],
    ['날씨·우비', '비 소식이 있어요. 우비나 우산을 챙겨 주세요! 많이 오면 전날 다시 알려 드릴게요.'],
    ['곧 시작해요', `곧 시작해요! ${activity.startTime}까지 ${meeting}(으)로 와 주세요. 체크인은 시작 30분 전부터 열려요.`],
  ]
  const replies = ['네, 괜찮아요!', '제가 준비해 갈게요.', '공지로 따로 알려 드릴게요.']
  const [latest, ...older] = thread.notices
  const canWrite = answering ? thread.canAnswer : organizer ? thread.canNotice : thread.canAsk
  const read = (post: Post) => organizer && post.readCount !== undefined && <span className="n-read"><MIcon name="check" size={14} />확정 {thread.audience}명 중 {post.readCount}명 읽음</span>
  const noticeCard = (post: Post, pinned: boolean) => <section key={post.id} className={'n-notice' + (pinned ? ' pinned' : '')}>
    <div className="n-notice-top"><MIcon name="flag" size={15} />{pinned ? '최신 공지' : '공지'}{post.unseen && <span className="n-new">NEW</span>}<small>{ago(post.createdAt)}</small></div>
    <p>{post.body}</p>
    <div className="n-notice-foot">{read(post)}{post.mine && <button type="button" className="m-text-btn" onClick={() => setRemoving(post)}>지우기</button>}</div>
  </section>

  return <div className="m-screen n-screen">
    <TopBar title="활동 소식" sub={subtitle} back="history" />
    <div className="m-body n-body">
      {organizer && <div className="m-seg-tabs inset" role="tablist" aria-label="소식 종류">
        <button role="tab" aria-selected={tab === 'notice'} className={tab === 'notice' ? 'on' : ''} onClick={() => { setTab('notice'); setAnswering(null) }}>공지</button>
        <button role="tab" aria-selected={tab === 'question'} className={tab === 'question' ? 'on' : ''} onClick={() => setTab('question')}>질문{thread.unanswered > 0 && <i>{thread.unanswered}</i>}</button></div>}

      {(!organizer || tab === 'notice') && (latest ? <>
        {noticeCard(latest, true)}
        {older.length > 0 && (allNotices || organizer ? older.map(post => noticeCard(post, false))
          : <button type="button" className="n-more" onClick={() => setAllNotices(true)}>이전 공지 {older.length}개 보기 <MIcon name="chevron" size={14} /></button>)}
      </> : <p className="n-empty">{organizer ? '아직 올린 공지가 없어요. 아래 버튼으로 쉽게 써 보세요.' : '아직 공지가 없어요.'}</p>)}

      {!organizer && <>
        {questions.length > 0 && <span className="n-day">질문과 답변</span>}
        {questions.map(q => <div key={q.id} className="n-qa">
          <span className={'n-who' + (q.mine ? ' r' : '')}>{q.mine ? '내 질문' : q.author}{q.private && <span className="n-lock"><MIcon name="lock" size={12} />모집자에게만</span>}{q.mine && <button type="button" className="n-del" onClick={() => setRemoving(q)}>지우기</button>}</span>
          <div className={'n-bub ' + (q.mine ? 'me' : 'other')}>{q.body}</div>
          {q.answer ? <><span className="n-who">모집자 <span className="m-badge mint">답변</span>{q.answer.unseen && <span className="n-new">NEW</span>}</span><div className="n-bub org">{q.answer.body}</div></>
            : q.mine && <span className="n-wait">답변을 기다리고 있어요</span>}
        </div>)}
        {questions.length === 0 && thread.canAsk && <p className="n-empty">궁금한 점이 있으면 아래에서 모집자에게 물어보세요.</p>}
      </>}

      {organizer && tab === 'question' && (thread.questions.length ? [...thread.questions].sort((a, b) => Number(Boolean(a.answer)) - Number(Boolean(b.answer))).map(q =>
        <section key={q.id} className={'n-qcard' + (!q.answer ? ' wait' : '') + (answering?.id === q.id ? ' on' : '')}>
          <span className="n-who">{q.author} · {ago(q.createdAt)}{q.private && <span className="n-lock"><MIcon name="lock" size={12} />나에게만</span>}{!q.answer && <span className="m-badge hot">답변 대기</span>}</span>
          <p>{q.body}</p>
          {q.answer ? <div className="n-ans"><b>내 답변</b> · {q.answer.body}</div>
            : thread.canAnswer && <button type="button" className="m-btn xs" onClick={() => { setAnswering(q); fill('') }}>답변하기</button>}
          <button type="button" className="n-del" onClick={() => setRemoving(q)}>지우기</button>
        </section>) : <p className="n-empty">아직 질문이 없어요.</p>)}
      <div ref={end} />
    </div>

    {canWrite ? <form className="n-composer" onSubmit={send}>
      {answering && <span className="n-target">{answering.author} 님 질문에 답변 <button type="button" className="m-text-btn" onClick={() => setAnswering(null)}>취소</button></span>}
      {organizer && !answering && tab === 'notice' && <div className="n-chips">{templates.map(([label, value]) => <button key={label} type="button" className="m-chip" onClick={() => fill(value)}>{label}</button>)}</div>}
      {answering && <div className="n-chips">{replies.map(value => <button key={value} type="button" className="m-chip" onClick={() => fill(value)}>{value}</button>)}</div>}
      {error && <p className="m-err" role="alert">{error}</p>}
      <div className="n-row">
        {!organizer && <button type="button" className={'n-private' + (privately ? ' on' : '')} aria-pressed={privately} aria-label="모집자에게만 보이기" onClick={() => setPrivately(!privately)}><MIcon name="lock" size={18} /></button>}
        <TextArea ref={input} rows={1} className="m-input n-input" aria-label={answering ? '답변 내용' : organizer ? '공지 내용' : '질문 내용'} maxLength={500}
          placeholder={answering ? '답변 쓰기' : organizer ? (tab === 'question' ? '질문을 골라 답변하거나 공지를 써요' : '공지 쓰기') : privately ? '모집자에게만 보이는 질문' : '모집자에게 질문하기'}
          value={text} onChange={event => { setText(event.target.value); setError('') }} onFocus={() => { if (organizer && tab === 'question' && !answering) setTab('notice') }} />
        <button className="n-send" aria-label="보내기" disabled={busy || !text.trim()}><MIcon name="send" size={20} /></button>
      </div>
      <span className="n-hint">{answering ? '질문한 사람에게 알림이 가요' : organizer ? `확정된 ${thread.audience}명에게 알림이 가요` : privately ? '나와 모집자만 볼 수 있어요' : '확정된 참가자 모두에게 보여요'} · 연락처는 올릴 수 없어요</span>
    </form> : <p className="n-closed">끝난 활동이라 새 글은 쓸 수 없어요.</p>}

    {removing && <Sheet title={removing.kind === 'NOTICE' ? '이 공지를 지울까요?' : '이 질문을 지울까요?'} onClose={() => setRemoving(null)}
      footer={<button type="button" className="m-btn danger" onClick={() => remove(removing)}>지우기</button>}>
      <p className="m-help">{removing.kind === 'QUESTION' ? '달린 답변도 함께 지워져요.' : '참가자 화면에서도 사라져요.'}</p></Sheet>}
  </div>
}
