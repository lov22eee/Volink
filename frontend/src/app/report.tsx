// 신고하기 (week 7, 2026-11-09): an activity, a post, a comment, a photo or a person — what is wrong, an optional note and up
// to 3 photos. One report per target; the result comes back as a notification (마이 › 내 이용 상태).
import { useState } from 'react'
import { api, ApiError } from '../api'
import { MIcon, Sheet, TextArea } from './ui'
import { PhotoField } from './photos'
import type { Shot } from './photos'

export type ReportTarget = { type: 'ACTIVITY' | 'POST' | 'COMMENT' | 'USER' | 'PHOTO'; id: number; label: string }
const reasons: [string, string][] = [['CONTACT', '연락처·외부 유도'], ['DANGER', '위험한 활동'], ['ABUSE', '욕설·혐오'], ['SPAM', '광고·도배'], ['FALSE_RECORD', '노쇼·허위 기록'], ['PRIVACY', '개인정보가 보여요'], ['OTHER', '기타']]

export function ReportSheet({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [text, setText] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const uploading = shots.some(s => !s.id && !s.failed)
  async function send() {
    setBusy(true); setError('')
    try {
      await api('/api/reports', 'POST', { targetType: target.type, targetId: target.id, reason, description: text.trim(), photoIds: shots.filter(s => s.id).map(s => s.id) })
      setDone(true)
    } catch (cause) { setError(cause instanceof ApiError ? (Object.values(cause.fieldErrors)[0] ?? cause.message) : '보내지 못했어요.') } finally { setBusy(false) }
  }
  if (done) return <Sheet title="" onClose={onClose} footer={<button type="button" className="m-btn" onClick={onClose}>확인</button>}>
    <div className="apply-res"><span className="apply-res-ico ok" aria-hidden="true"><MIcon name="check" size={28} /></span>
      <h3 className="m-h3">신고를 받았어요</h3><p className="m-help center">확인 후 결과를 알림으로 알려 드려요</p></div></Sheet>
  return <Sheet title="신고하기" onClose={onClose} footer={<button type="button" className="m-btn danger" disabled={!reason || busy || uploading} onClick={send}>{busy ? '보내는 중…' : '신고 보내기'}</button>}>
    <div className="rp-target"><MIcon name="alert" size={16} /><span>{target.label}</span></div>
    <span className="m-label">어떤 문제인가요?</span>
    <div className="m-chips wrap">{reasons.map(([k, label]) => <button key={k} type="button" className={'m-chip' + (reason === k ? ' on danger' : '')} aria-pressed={reason === k} onClick={() => setReason(k)}>{label}</button>)}</div>
    <span className="m-label">자세히 (선택)</span>
    <TextArea className="m-input" rows={3} maxLength={1000} value={text} placeholder="어떤 점이 문제인지 알려 주세요" onChange={e => setText(e.target.value)} />
    <span className="m-label">증빙 사진 (최대 3장)</span>
    <PhotoField shots={shots} onChange={setShots} max={3} />
    <p className="m-help">허위 신고는 제재될 수 있어요. 신고한 사람은 상대에게 알려지지 않아요.</p>
    {error && <p className="m-err" role="alert">{error}</p>}
  </Sheet>
}
