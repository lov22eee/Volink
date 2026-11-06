// 한글 입력 진단 (#/ime-lab, 2026-11-06): the same Korean sentence in four kinds of text box, side by side, on a real
// phone. Each box counts its own events; the numbers are read every 0.3 s by a separate line so counting never
// re-renders the box being tested. Not linked from any menu; open it by typing the address or from the login screen.
import { useEffect, useRef, useState } from 'react'
import { TextArea } from './ui'

type Counts = { input: number; cstart: number; cupdate: number; cend: number; renders: number; length: number }
const fresh = (): Counts => ({ input: 0, cstart: 0, cupdate: 0, cend: 0, renders: 0, length: 0 })
const SENTENCE = '안녕하세요 오늘 양주 공원에서 쓰레기 줍기 봉사를 했어요'
const capture = import.meta.env.VITE_CAPTURE_INPUT === '1'

/** Counts the events of every text box inside it (listening on the wrapper, so the box itself is untouched). */
function Probe({ title, note, counts, children }: { title: string; note: string; counts: React.MutableRefObject<Counts>; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<Counts>(fresh())
  useEffect(() => {
    const el = box.current!
    const on = (type: string, key: keyof Counts) => { const f = () => { counts.current[key]++ }; el.addEventListener(type, f, true); return () => el.removeEventListener(type, f, true) }
    const off = [on('input', 'input'), on('compositionstart', 'cstart'), on('compositionupdate', 'cupdate'), on('compositionend', 'cend')]
    const t = window.setInterval(() => {
      const field = el.querySelector('textarea')
      counts.current.length = field ? [...field.value].length : 0
      setShown({ ...counts.current })
    }, 300)
    return () => { off.forEach(f => f()); window.clearInterval(t) }
  }, [counts])
  return <section className="lab-box">
    <h2>{title}</h2><p className="lab-note">{note}</p>
    <div ref={box}>{children}</div>
    <p className="lab-nums">글자 {shown.length} · input {shown.input} · 조합 시작 {shown.cstart} · 조합 중 {shown.cupdate} · 조합 끝 {shown.cend}{shown.renders ? ` · 렌더 ${shown.renders}` : ''}</p>
  </section>
}

function PlainBox() {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => { if (host.current && !host.current.firstChild) { const t = document.createElement('textarea'); t.className = 'm-input'; t.rows = 3; t.dataset.noSync = '1'; host.current.appendChild(t) } }, [])
  return <div ref={host} />
}
function SlimLogBox({ counts }: { counts: React.MutableRefObject<Counts> }) {
  const [value, setValue] = useState('')
  counts.current.renders++
  return <textarea className="m-input" rows={3} data-no-sync="1" value={value} onChange={event => setValue(event.target.value)} />
}
function VolinkBox({ counts, sync }: { counts: React.MutableRefObject<Counts>; sync: boolean }) {
  const [value, setValue] = useState('')
  counts.current.renders++
  return <TextArea className="m-input" rows={3} data-no-sync={sync ? undefined : '1'} value={value} onChange={event => setValue(event.target.value)} />
}

export function ImeLab() {
  const a = useRef(fresh()), b = useRef(fresh()), c = useRef(fresh()), d = useRef(fresh())
  const [round, setRound] = useState(0)
  const reset = () => { for (const r of [a, b, c, d]) r.current = fresh(); setRound(round + 1) }
  return <div className="m-screen"><div className="m-body lab" key={round}>
    <h1>한글 입력 진단</h1>
    <p className="lab-env">captureInput: <b>{capture ? '켬 (예전 설정)' : '끔'}</b> · 커밋 {import.meta.env.VITE_COMMIT ?? 'local'}</p>
    <p className="lab-sentence">아래 문장을 네 칸에 똑같이 입력해 보세요.<br /><b>{SENTENCE}</b></p>
    <Probe title="A. 순수 HTML 입력칸" note="React 없음, 보정 없음" counts={a}><PlainBox /></Probe>
    <Probe title="B. SlimLog 방식" note="React가 값을 관리하는 기본 textarea, 보정 없음" counts={b}><SlimLogBox counts={b} /></Probe>
    <Probe title="C. Volink TextArea (지금)" note="React가 안 건드리는 입력칸 + 80ms 보정" counts={c}><VolinkBox counts={c} sync /></Probe>
    <Probe title="D. Volink TextArea, 보정 끔" note="C에서 80ms 보정·조합 동기화만 뺌" counts={d}><VolinkBox counts={d} sync={false} /></Probe>
    <button type="button" className="m-btn line" onClick={reset}>모두 지우고 다시</button>
    <a className="m-btn line" href="#/login">돌아가기</a>
  </div></div>
}
