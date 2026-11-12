// 설정 (마이 → 톱니바퀴): app settings, the linked login account and 회원 탈퇴. 마이 keeps only what is about me.
import { keep1365, labOn, logout1365, saveExtMode, setKeep1365, setLabOn, useExtMode } from './lab'
import { useEffect, useState } from 'react'
import { api } from '../api'
import type { User } from '../api'
import { showToast } from '../App'
import { ActionBar, Loading, MIcon, Sheet, TopBar } from './ui'
import type { MIconName } from './ui'

type Account = { method: 'EMAIL' | 'KAKAO' | 'GOOGLE'; email: string | null; links: { provider: string; linkedOn: string }[]; joinedOn: string; memberType: string }
type Preview = { blocking: { id: number; title: string; date: string }[]; applications: number; hosted: number; allowed: boolean }

export const providerName: Record<string, string> = { KAKAO: '카카오', GOOGLE: '구글', EMAIL: '이메일' }
/** A social member without a real e-mail has a placeholder that must never be shown. */
export const shownEmail = (email: string) => email.endsWith('.invalid') ? null : email
export const loginLabel = (user: User) => user.providers?.length ? providerName[user.providers[0]] + '로 가입' : '이메일로 가입'

const BIG = 'volink.bigText'
export function applyTextSize() {
  let big = false
  try { big = localStorage.getItem(BIG) === '1' } catch { /* storage blocked */ }
  document.documentElement.classList.toggle('m-big', big)
  return big
}

/** note = a short value on the right (가져오기); desc = a sentence under the label (2026-11-12: on the right it squeezed the label to one letter a line). */
type Row = { icon: MIconName; label: string; href?: string; note?: string; desc?: string; onClick?: () => void; toggle?: boolean }
function Group({ title, rows }: { title: string; rows: Row[] }) {
  return <section className="m-set-group" aria-label={title}><h2>{title}</h2><div className="m-set-card">{rows.map(row => {
    const inner = <><MIcon name={row.icon} size={21} /><span className={row.desc ? 'm-set-text' : undefined}>{row.label}{row.desc && <small>{row.desc}</small>}</span>{row.note && <small className="m-set-note">{row.note}</small>}
      {row.toggle === undefined ? <MIcon name="chevron" size={18} /> : <i className={'m-set-switch' + (row.toggle ? ' on' : '')} aria-hidden="true" />}</>
    return row.href ? <a key={row.label} href={row.href}>{inner}</a>
      : <button key={row.label} type="button" onClick={row.onClick} {...(row.toggle !== undefined ? { role: 'switch', 'aria-checked': row.toggle } : {})}>{inner}</button>
  })}</div></section>
}

/** Which build this is (APK: version · run number · commit), so a test phone shows which code it runs. */
const buildLabel = `앱 ${import.meta.env.VITE_APP_VERSION ?? '0.6'}${import.meta.env.VITE_BUILD_NUMBER ? ' (빌드 ' + import.meta.env.VITE_BUILD_NUMBER + ')' : ''} · 커밋 ${import.meta.env.VITE_COMMIT ?? 'local'}`

export function SettingsScreen({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const [big, setBig] = useState(() => document.documentElement.classList.contains('m-big'))
  const [leaving, setLeaving] = useState(false)
  const [lab, setLab] = useState(labOn)
  const [keep, setKeep] = useState(keep1365)
  const extMode = useExtMode()
  async function switchMode() {
    const next = extMode === 'IMPORT' ? 'MANUAL' : 'IMPORT'
    try { await saveExtMode(next); if (next === 'IMPORT') setLab(true); showToast(next === 'IMPORT' ? '1365 기록을 가져오기로 바꿨어요' : '1365 기록을 직접 남기기로 바꿨어요') } catch { showToast('바꾸지 못했어요') }
  }
  function toggleBig() {
    try { localStorage.setItem(BIG, big ? '0' : '1') } catch { /* storage blocked */ }
    setBig(applyTextSize())
  }
  return <div className="m-screen"><TopBar title="설정" back="#/my" />
    <div className="m-body">
      <Group title="앱 설정" rows={[
        { icon: 'bell', label: '알림 설정', href: '#/my?view=notice-settings' },
        { icon: 'edit', label: '글자 크게 보기', toggle: big, onClick: toggleBig },
      ]} />
      <Group title="실험실" rows={[
        ...(user.memberType === 'INSTITUTION' ? [] : [{ icon: 'record' as MIconName, label: '1365 기록 방식', note: extMode === 'IMPORT' ? '가져오기' : extMode === 'MANUAL' ? '직접 남기기' : '고르지 않음', onClick: switchMode }]),
        { icon: 'flask', label: '1365 연결 (실험)', desc: '내 1365 신청 내역 가져오기', toggle: lab, onClick: () => { setLabOn(!lab); setLab(!lab) } },
        ...(lab ? [{ icon: 'outward' as MIconName, label: '1365 신청 내역 가져오기', href: '#/lab1365' }] : []),
        ...(lab ? [{ icon: 'lock' as MIconName, label: '1365 로그인 유지', desc: '이 휴대폰에서만 로그인을 기억해요', toggle: keep, onClick: () => { setKeep1365(!keep); setKeep(!keep) } },
          { icon: 'logout' as MIconName, label: '1365 로그아웃', desc: '이 휴대폰의 1365 로그인 기록 지우기', onClick: () => { void logout1365().then(() => showToast('1365에서 로그아웃했어요')) } }] : []),
      ]} />
      <Group title="계정" rows={[
        { icon: 'user', label: '연결된 로그인 계정', href: '#/settings?view=account', note: loginLabel(user) },
      ]} />
      <button type="button" className="m-btn line" onClick={() => setLeaving(true)}><MIcon name="logout" size={19} />로그아웃</button>
      <p className="m-help center m-build">{buildLabel}</p>
    </div>
    {leaving && <Sheet title="로그아웃할까요?" onClose={() => setLeaving(false)} footer={<div className="m-two"><button type="button" className="m-btn line" onClick={() => setLeaving(false)}>돌아가기</button><button type="button" className="m-btn" onClick={onSignOut}>로그아웃</button></div>} />}
  </div>
}

export function AccountScreen({ onWithdrawn }: { onWithdrawn: () => void }) {
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [step, setStep] = useState<'view' | 'confirm'>('view')
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<Account>('/api/me/account').then(setAccount).catch(() => setAccount(null)) }, [])
  useEffect(() => { if (step === 'confirm') api<Preview>('/api/me/withdrawal').then(setPreview).catch(() => setPreview(null)) }, [step])

  async function withdraw() {
    setBusy(true)
    try {
      await api('/api/me/withdraw', 'POST', { confirm: true })
      // After the switch to the login screen (its own toast host), or the toast goes away with this screen.
      await onWithdrawn()
      window.setTimeout(() => showToast('완료되었습니다.', '그동안 이용해 주셔서 감사합니다.'), 150)
    } catch (error) {
      showToast(error instanceof Error ? error.message : '탈퇴하지 못했어요')
      api<Preview>('/api/me/withdrawal').then(setPreview).catch(() => {})
    } finally { setBusy(false) }
  }

  if (step === 'confirm') return <div className="m-screen"><TopBar title="회원 탈퇴" back={() => { setStep('view'); setAgreed(false) }} />
    <div className="m-body">{!preview ? <Loading /> : <>
      {preview.blocking.length > 0 ? <section className="m-set-card pad warn" aria-label="먼저 해야 할 일">
        <strong>신청자가 있는 모집 활동이 있어요</strong>
        <p>아래 활동을 먼저 취소해야 탈퇴할 수 있어요.</p>
        <div className="m-set-links">{preview.blocking.map(a => <a key={a.id} href={'#/manage/' + a.id}><span>{a.title}</span><small>{a.date}</small><MIcon name="chevron" size={17} /></a>)}</div>
      </section> : null}
      {/* 2026-11-07: no card — a title, rows with the app's line icons, the check and the buttons at the bottom. */}
      <section className="wd" aria-label="탈퇴하면">
        <h2 className="wd-title">탈퇴하면 이렇게 돼요</h2>
        <ul className="wd-list">
          {preview.applications > 0 && <li><MIcon name="calendar" size={20} /><span>시작 전인 신청 <b>{preview.applications}개</b>가 취소되고, 자리는 다음 대기자에게 넘어가요.</span></li>}
          {preview.hosted > 0 && <li><MIcon name="trash" size={20} /><span>내가 올린 모집글 <b>{preview.hosted}개</b>가 지난 것까지 모두 삭제돼요. 커뮤니티 후기에 붙은 모집글 연결도 사라져요.</span></li>}
          <li><MIcon name="user" size={20} /><span>이름·이메일·생년월일·닉네임·관심 분야·저장한 봉사·알림이 지워져요.</span></li>
          <li><MIcon name="chat" size={20} /><span>커뮤니티 글과 댓글은 남고 작성자는 ‘탈퇴한 회원’으로 보여요. 지우고 싶은 글은 탈퇴 전에 지워 주세요.</span></li>
          <li><MIcon name="alert" size={20} /><span>Volink 활동 기록은 되살릴 수 없어요. 같은 카카오·구글 계정으로 다시 가입하면 새 계정이 돼요.</span></li>
        </ul>
      </section>
    </>}</div>
    {preview && <ActionBar>
      <div className="wd-foot">
        <label className="m-check wd-agree"><input type="checkbox" checked={agreed} onChange={event => setAgreed(event.target.checked)} /><span className="m-box" /><span>위 내용을 확인했고 탈퇴할게요.</span></label>
        <div className="m-two">
          <button type="button" className="m-btn line" onClick={() => { setStep('view'); setAgreed(false) }}>돌아가기</button>
          <button type="button" className="m-btn danger" disabled={!agreed || busy || !preview.allowed} onClick={withdraw}>탈퇴하기</button>
        </div>
      </div>
    </ActionBar>}
  </div>

  return <div className="m-screen"><TopBar title="연결된 로그인 계정" back="#/settings" />
    <div className="m-body">{account === undefined ? <Loading /> : account === null ? <p className="m-help">계정 정보를 불러오지 못했어요.</p> : <>
      <section className="m-set-group" aria-label="로그인 계정"><h2>로그인 계정</h2><div className="m-set-card">
        <div className="m-set-row">
          <span className={'m-login-ico ' + account.method.toLowerCase()} aria-hidden="true">{account.method === 'KAKAO' ? <KakaoMark /> : account.method === 'GOOGLE' ? <b>G</b> : <MIcon name="mail" size={20} />}</span>
          <span><b>{account.method === 'EMAIL' ? '이메일' : providerName[account.method] + ' 로그인'}</b><small>{account.email ?? '이메일 정보 없음'}</small></span>
          <span className="m-set-ok">연결됨</span>
        </div>
      </div></section>
      <section className="m-set-group" aria-label="계정 관리"><h2>계정 관리</h2><div className="m-set-card">
        <div className="m-set-row"><span><b>가입일</b></span><small>{account.joinedOn.replaceAll('-', '. ')}</small></div>
        {account.memberType === 'GENERAL'
          ? <button type="button" className="danger" onClick={() => setStep('confirm')}><MIcon name="userX" size={21} /><span>회원 탈퇴</span><MIcon name="chevron" size={18} /></button>
          : <div className="m-set-row"><span><b>회원 탈퇴</b><small>기관 회원 탈퇴는 관리자에게 문의해 주세요.</small></span></div>}
      </div></section>
    </>}</div>
  </div>
}

/** Kakao's speech-bubble mark on its yellow (a plain shape, no wordmark). */
function KakaoMark() {
  return <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#191600" d="M12 3.5c-5 0-9 3.1-9 7 0 2.5 1.7 4.7 4.2 5.9l-.9 3.4c-.1.3.3.6.6.4l4-2.6h1.1c5 0 9-3.1 9-7s-4-7.1-9-7.1z" /></svg>
}
