// 활동 소식: the organizer's notices and the confirmed participants' questions with the organizer's answers, in one
// place on the activity. No real-time chat and no contact details (the server refuses phone numbers, e-mails and
// open-chat links); everyone here already holds a confirmed place, and names stay partly hidden.
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError } from './api'
import { ConfirmDialog, Icon, Notice, showToast } from './App'

type Post = { id: number; kind: 'NOTICE' | 'QUESTION' | 'ANSWER'; body: string; createdAt: string; author: string; mine: boolean; answer?: Post | null }
type Thread = { canNotice: boolean; canAsk: boolean; canAnswer: boolean; unanswered: number; notices: Post[]; questions: Post[] }

/** "오늘 14:05" / "11월 3일 14:05" from the server's Korean "yyyy-MM-ddTHH:mm". */
function when(value: string) {
  const [date, time] = value.split('T')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  return (date === today ? '오늘' : `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일`) + ' ' + time
}

const message = (cause: unknown) => cause instanceof ApiError ? (cause.fieldErrors.body ?? cause.message) : cause instanceof Error ? cause.message : '처리하지 못했습니다.'

export function ActivityNews({ activityId, organizer }: { activityId: number; organizer: boolean }) {
  const [data, setData] = useState<Thread | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [answering, setAnswering] = useState<{ id: number; body: string } | null>(null)
  const [removing, setRemoving] = useState<Post | null>(null)
  const load = useCallback(() => api<Thread>('/api/activities/' + activityId + '/posts').then(setData).catch(() => setData(null)), [activityId])
  useEffect(() => { load() }, [load])
  if (!data) return null
  const thread = data

  async function run(path: string, body: object, done: string, after: () => void) {
    setBusy(true)
    setError('')
    try {
      await api(path, 'POST', body)
      after()
      showToast(done)
      load()
    } catch (cause) {
      setError(message(cause))
    } finally {
      setBusy(false)
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    if (thread.canNotice) run('/api/activities/' + activityId + '/notices', { body: text }, '공지를 올렸어요', () => setText(''))
    else run('/api/activities/' + activityId + '/questions', { body: text }, '질문을 남겼어요', () => setText(''))
  }
  async function remove(post: Post) {
    try {
      await api('/api/activity-posts/' + post.id, 'DELETE')
      showToast(post.kind === 'NOTICE' ? '공지를 지웠어요' : '질문을 지웠어요')
      load()
    } catch (cause) {
      setError(message(cause))
    }
  }
  const canWrite = thread.canNotice || thread.canAsk
  const empty = thread.notices.length === 0 && thread.questions.length === 0
  return <section className="news" aria-label="활동 소식">
    <div className="news-head"><h2>활동 소식</h2>{organizer && thread.unanswered > 0 && <span className="status-chip wait">답변할 질문 {thread.unanswered}</span>}</div>
    <p className="small-print news-lede">{organizer ? '확정된 참가자 모두에게 보여요. 공지를 올리면 알림이 가요.' : '모집자의 공지와 참가자 질문이 모여요. 연락처는 공유하지 않아요.'}</p>
    {thread.notices.length > 0 && <ul className="news-list" aria-label="공지">{thread.notices.map(post => <li key={post.id} className="news-item notice">
      <span className="news-icon" aria-hidden="true"><Icon name="bell" size={16} /></span>
      <div className="news-main"><span className="news-meta"><b>공지</b> · {when(post.createdAt)}</span><p>{post.body}</p></div>
      {post.mine && <button className="text-button news-del" onClick={() => setRemoving(post)}>지우기</button>}
    </li>)}</ul>}
    {thread.questions.length > 0 && <ul className="news-list" aria-label="질문과 답변">{thread.questions.map(post => <li key={post.id} className="news-item question">
      <span className="news-icon q" aria-hidden="true">Q</span>
      <div className="news-main">
        <span className="news-meta"><b>{post.mine ? '내 질문' : post.author}</b> · {when(post.createdAt)}</span><p>{post.body}</p>
        {post.answer ? <div className="news-answer"><span className="news-meta"><b>모집자 답변</b> · {when(post.answer.createdAt)}</span><p>{post.answer.body}</p></div>
          : thread.canAnswer && (answering?.id === post.id
            ? <form className="news-form inline" onSubmit={event => { event.preventDefault(); run('/api/activity-posts/' + post.id + '/answer', { body: answering.body }, '답변을 달았어요', () => setAnswering(null)) }}>
              <textarea aria-label="답변 내용" value={answering.body} maxLength={500} rows={2} placeholder="답변을 적어 주세요" onChange={event => setAnswering({ id: post.id, body: event.target.value })} />
              <div className="button-row"><button className="pill-button dark small" disabled={busy || !answering.body.trim()}>답변 달기</button><button type="button" className="pill-button line small" onClick={() => setAnswering(null)}>취소</button></div>
            </form>
            : <button className="pill-button line small news-reply" onClick={() => setAnswering({ id: post.id, body: '' })}>답변하기</button>)}
        {!post.answer && !thread.canAnswer && <span className="news-wait">답변을 기다리고 있어요</span>}
      </div>
      {(post.mine || organizer) && <button className="text-button news-del" onClick={() => setRemoving(post)}>지우기</button>}
    </li>)}</ul>}
    {empty && <p className="news-empty">{thread.canNotice ? '아직 올린 공지가 없어요. 준비물·집결 안내를 올려 보세요.' : thread.canAsk ? '궁금한 점이 있으면 모집자에게 물어보세요.' : '아직 올라온 소식이 없어요.'}</p>}
    {canWrite && <form className="news-form" onSubmit={submit}>
      <textarea aria-label={thread.canNotice ? '공지 내용' : '질문 내용'} value={text} maxLength={500} rows={2}
        placeholder={thread.canNotice ? '예: 장갑은 제가 챙겨갈게요. 정문 안내판 앞에서 만나요.' : '예: 주차할 곳이 있나요?'} onChange={event => { setText(event.target.value); setError('') }} />
      <div className="news-form-foot"><small>{text.length} / 500 · 전화번호·이메일·오픈채팅은 올릴 수 없어요</small><button className="pill-button dark small" disabled={busy || !text.trim()}>{thread.canNotice ? '공지 올리기' : '질문하기'}</button></div>
    </form>}
    {error && <Notice text={error} tone="error" />}
    {removing && <ConfirmDialog title={removing.kind === 'NOTICE' ? '이 공지를 지울까요?' : '이 질문을 지울까요?'} body={removing.kind === 'QUESTION' ? '달린 답변도 함께 지워져요.' : '참가자 화면에서도 사라져요.'}
      confirm="지우기" danger onConfirm={() => remove(removing)} onClose={() => setRemoving(null)} />}
  </section>
}
