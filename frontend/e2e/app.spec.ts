import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// Local dev only: the ignored ../.env holds the database user and the demo admin password.
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter(row => row.includes('=') && !row.startsWith('#')).map(row => [row.slice(0, row.indexOf('=')), row.slice(row.indexOf('=') + 1).trim()]))
/** Moves an activity's start so check-in is open now (the API never allows this; dev database only). */
function moveActivity(id: string, startMinutesFromNow: number) {
  const korea = (minutes: number) => new Date(Date.now() + 9 * 3_600_000 + minutes * 60_000).toISOString().slice(0, 19).replace('T', ' ')
  const sql = `UPDATE activities SET starts_at = '${korea(startMinutesFromNow)}', ends_at = '${korea(startMinutesFromNow + 60)}' WHERE id = ${Number(id)}`
  execFileSync('docker', ['compose', 'exec', '-T', '-e', 'MYSQL_PWD=' + env.MYSQL_PASSWORD, 'db', 'mysql', '-u', env.MYSQL_USER, process.env.E2E_MYSQL_DATABASE ?? env.MYSQL_DATABASE, '-e', sql], { cwd: '..' })
}

// Android app screens (vite --mode app). Login first, five bottom tabs, state-based detail, organizer dashboard.
const password = 'example123'
const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const inDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 86_400_000))

async function signupByApi(page: Page, name: string) {
  const email = unique('app')
  const response = await page.request.post('/api/auth/signup', { data: { memberType: 'GENERAL', name, email, password, birthDate: '2000-01-01', interests: ['환경'], agreedNotice: true } })
  expect(response.ok()).toBeTruthy()
  return email
}

/** Our own calendar sheet (2026-11-06): open the field, go to the month, tap the day. */
async function pickDay(page: Page, field: string | RegExp, date: string) {
  await page.getByRole('button', { name: field }).last().click()
  const sheet = page.getByRole('dialog', { name: '날짜' })
  const [y, m, d] = date.split('-').map(Number)
  for (let i = 0; i < 14 && !(await sheet.getByText(`${y}년 ${m}월`).count()); i++) await sheet.getByRole('button', { name: '다음 달' }).click()
  await sheet.locator('button.m-day').filter({ hasText: new RegExp(`^${d}$`) }).click()
  await expect(sheet).toHaveCount(0)
}

async function login(page: Page, email: string) {
  await page.goto('/#/login')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL(/#\/home$/)
}

test('login tabs: 기관회원 signs up with e-mail only, waits for 기관 확인, and a wrong tab is pointed to the right one', async ({ page }) => {
  // Personal tab shows Kakao / Google; the institution tab hides them and says e-mail only.
  await page.goto('/#/login')
  await expect(page.getByRole('button', { name: '카카오로 로그인' })).toBeVisible()
  await page.getByRole('tab', { name: '기관회원' }).click()
  await expect(page.getByRole('button', { name: '카카오로 로그인' })).toHaveCount(0)
  await expect(page.getByText('기관회원은 이메일로만 로그인할 수 있어요')).toBeVisible()
  // A personal account on the institution tab: the right password, no session, a pointer to the other tab.
  const personal = await signupByApi(page, '개인 탭 확인')
  await page.getByLabel('이메일').fill(personal)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('개인 회원 계정이에요. 개인회원 탭에서 로그인해 주세요.')
  await expect(page).toHaveURL(/#\/login/)

  // 기관회원 가입: agreements first, the manager (e-mail, password, name — no birth date), then the organization.
  await page.getByRole('link', { name: '기관회원 가입' }).click()
  await expect(page.getByRole('heading', { name: '시작하기 전에 확인해 주세요' })).toBeVisible()
  const next = page.getByRole('button', { name: '다음' })
  await expect(next).toBeDisabled()
  await page.getByText('모두 동의').click()
  await next.click()
  await expect(page.getByRole('heading', { name: '담당자 이메일을 알려 주세요' })).toBeVisible()
  const email = unique('org')
  await page.getByPlaceholder('example@email.com').fill(email)
  await next.click()
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await next.click()
  await page.getByPlaceholder('이름').fill('기관 담당자')
  await next.click()
  await expect(page.getByRole('heading', { name: '어떤 기관인가요?' })).toBeVisible()
  await page.getByRole('button', { name: '자원봉사센터' }).click()
  await next.click()
  const orgName = '앱 시험 기관 ' + Date.now()
  await page.getByLabel('기관명').fill(orgName)
  await next.click()
  await expect(page.getByRole('heading', { name: '기관 주소를 알려 주세요' })).toBeVisible()
  await page.getByRole('button', { name: /직접 입력/ }).click()
  await page.getByLabel('기관 주소').fill('경기 양주시 부흥로 1533')
  await next.click()
  await page.getByLabel('기관 연락처').fill('031-000-0000')
  await next.click()
  await expect(page.getByRole('heading', { name: '1365 수요처인가요?' })).toBeVisible()
  await page.getByRole('button', { name: '네, 등록돼 있어요' }).click()
  await page.getByLabel('1365 수요처 번호').fill('VMS-77')
  await page.getByRole('button', { name: '제출하기' }).click()
  // Right after: may we tell you when it is done? (the phone prompt is not available in the browser test)
  const ask = page.getByRole('dialog', { name: '기관 확인이 끝나면 알려 드릴까요?' })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: '허용하지 않기' }).click()
  // Before 기관 확인: only the review status (no tabs).
  await expect(page.getByRole('heading', { name: '기관 확인을 기다리고 있어요' })).toBeVisible()
  await expect(page.getByText(orgName)).toBeVisible()
  await expect(page.getByRole('navigation', { name: '주요 메뉴' })).toHaveCount(0)
  await page.getByRole('button', { name: '다시 확인하기' }).click()
  await expect(page.getByText('아직 확인 중이에요')).toBeVisible()

  // The admin confirms it (with a reason) → 다시 확인하기 opens the app.
  const adminLogin = await page.request.post('/api/auth/login', { data: { email: 'admin-01@demo.volink.kr', password: env.DEMO_ACCOUNT_PASSWORD } })
  const admin = 'Bearer ' + (await adminLogin.json()).accessToken
  const pending = await (await page.request.get('/api/admin/organizations?status=PENDING', { headers: { Authorization: admin } })).json() as { id: number; name: string }[]
  const org = pending.find(o => o.name === orgName)!
  expect((await page.request.post(`/api/admin/organizations/${org.id}/approve`, { headers: { Authorization: admin }, data: { reason: '앱 시험 기관 확인' } })).ok()).toBeTruthy()
  await page.getByRole('button', { name: '다시 확인하기' }).click()
  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.getByRole('navigation', { name: '주요 메뉴' })).toBeVisible()

  // The institution account on the personal tab is pointed back.
  const other = await browserLogin(page, email, 'GENERAL')
  expect(other.code).toBe('MEMBER_TYPE_MISMATCH')
})

async function browserLogin(page: Page, email: string, memberType: string) {
  return (await page.request.post('/api/auth/login', { data: { email, password, memberType } })).json() as Promise<{ code?: string }>
}

async function tokenFor(page: Page, email: string) {
  const response = await page.request.post('/api/auth/login', { data: { email, password } })
  return 'Bearer ' + (await response.json()).accessToken
}

test('nothing is shown before signing in, and the personal tab signs up a personal member one question at a time', async ({ page }) => {
  await page.goto('/#/find')
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '주요 메뉴' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: '개인회원' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('link', { name: '회원가입' }).click()
  // Agreements first; one question per screen; no answers piled up below.
  await expect(page.getByRole('heading', { name: '시작하기 전에 확인해 주세요' })).toBeVisible()
  const next = page.getByRole('button', { name: '다음' })
  await expect(next).toBeDisabled()
  await page.getByText('모두 동의').click()
  await next.click()
  await expect(page.getByRole('heading', { name: '이메일을 알려 주세요' })).toBeVisible()
  await expect(next).toBeDisabled()
  await page.getByPlaceholder('example@email.com').fill(unique('signup'))
  await next.click()
  await expect(page.getByRole('heading', { name: '비밀번호를 정해 주세요' })).toBeVisible()
  await page.getByLabel('비밀번호', { exact: true }).fill('abcdefgh')
  await expect(page.getByLabel('비밀번호 확인')).toHaveCount(0)
  await page.getByLabel('비밀번호', { exact: true }).fill('abcd1234')
  await page.getByLabel('비밀번호 확인').fill('abcd1234')
  await next.click()
  await expect(page.getByRole('button', { name: '이메일 고치기' })).toHaveCount(0)
  await page.getByPlaceholder('이름').fill('앱 회원')
  await next.click()
  // The birth wheel is on the page; under 14 cannot go on.
  await page.getByRole('option', { name: `${new Date().getFullYear() - 10}년` }).click()
  await expect(next).toBeDisabled()
  await page.getByRole('option', { name: '2003년' }).click()
  await next.click()
  // Interests are optional: pick up to 3 or leave them for later.
  await expect(page.getByRole('heading', { name: '관심 있는 봉사를 골라 주세요' })).toBeVisible()
  await expect(page.getByRole('button', { name: '나중에 고르고 가입하기' })).toBeVisible()
  await page.getByRole('button', { name: '환경' }).click()
  await expect(page.getByText('기관 회원', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '가입하고 시작하기' }).click()
  // Right after signup: why location, then why notifications; both can wait.
  await expect(page).toHaveURL(/#\/welcome$/)
  await expect(page.getByRole('heading', { name: '위치를 허용해 주세요' })).toBeVisible()
  await page.getByRole('button', { name: '나중에 할게요' }).click()
  await expect(page.getByRole('heading', { name: '알림을 받을까요?' })).toBeVisible()
  await page.getByRole('button', { name: '나중에 할게요' }).click()
  await page.getByRole('button', { name: '괜찮아요, 직접 남길게요' }).click()
  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.getByRole('heading', { name: /앱 회원님/ })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link')).toHaveCount(5)
})

test('an organizer creates in three steps, a member applies, the organizer approves, and moves the date, and the member is told', async ({ page, browser }) => {
  const organizer = await signupByApi(page, '앱 모집자')
  await login(page, organizer)
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '찾기' }).click()
  await page.getByRole('link', { name: '모집하기' }).click()
  await page.getByRole('link', { name: '새 활동 만들기' }).click()
  await page.getByRole('button', { name: '다음' }).click()
  await expect(page.getByText(/활동 이름은 5~100자/)).toBeVisible()
  await page.locator('input[name=title]').fill('앱에서 만든 공원 정리 모임')
  await page.getByRole('button', { name: '보통' }).click()
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByRole('button', { name: /장소를 골라/ }).click()
  // Full-screen 장소 고르기: the choice and its button stay fixed at the bottom; 만나는 곳 stays on the form.
  const dialog = page.getByRole('dialog', { name: '장소 고르기' })
  await expect(dialog.getByRole('button', { name: '장소를 골라 주세요' })).toBeDisabled()
  // Typing shows suggestions with their badge right under the search box.
  await dialog.getByLabel('장소 이름이나 주소').fill('옥정')
  const suggest = dialog.getByRole('list', { name: '추천 장소' })
  await expect(suggest.getByRole('button', { name: /옥정중앙공원.*바로 공개/ })).toBeVisible()
  await suggest.getByRole('button', { name: /옥정중앙공원/ }).click()
  await expect(suggest).toHaveCount(0)
  await dialog.getByRole('button', { name: '옥정중앙공원으로 정하기' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('button', { name: /옥정중앙공원.*바꾸기/ })).toBeVisible()
  await page.locator('textarea[name=description]').fill('공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.')
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByRole('button', { name: '한 명 줄이기' }).click()
  await page.getByRole('button', { name: '모집 시작하기' }).click()
  await expect(page.getByText(/안전 안내를 확인/)).toBeVisible()
  await page.locator('input[name=safety]').check({ force: true })
  await page.getByRole('button', { name: '모집 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '모집을 시작했어요!' })).toBeVisible()
  // Once after a new recruitment: put it in the phone calendar? (a file download, skipped here)
  await expect(page.getByRole('dialog', { name: '내 캘린더에도 넣어 둘까요?' })).toBeVisible()
  await page.getByRole('button', { name: '괜찮아요' }).click()
  await page.getByRole('link', { name: '모집 관리로 가기' }).click()
  const id = page.url().match(/manage\/(\d+)/)![1]

  const memberPage = await browser.newPage({ baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 } })
  const member = await signupByApi(memberPage, '앱 참가자')
  await login(memberPage, member)
  await memberPage.goto('/#/activity/' + id)
  await memberPage.getByRole('button', { name: '신청하기' }).click()
  await memberPage.getByRole('dialog').getByRole('button', { name: '신청하기' }).click()
  await expect(memberPage.getByText('모집자 확인을 기다리고 있어요')).toBeVisible()

  await page.reload()
  await page.getByRole('button', { name: '승인', exact: true }).click()
  await expect(page.getByText('참가 확정').first()).toBeVisible()
  await page.getByRole('button', { name: '활동 메뉴' }).click()
  await page.getByRole('dialog', { name: '활동 관리' }).getByRole('button', { name: /일정 바꾸기/ }).click()
  await page.getByRole('button', { name: /^시작/ }).click()
  await page.getByRole('option', { name: '오후 2시' }).click()
  await page.getByRole('button', { name: /14:00 시작/ }).click()
  await page.getByPlaceholder(/장소 사정/).fill('오전에 행사가 있어 오후로 옮겨요')
  await page.getByRole('button', { name: '바꾸고 알리기' }).click()
  await expect(page.getByText(/14:00/).first()).toBeVisible()

  await memberPage.reload()
  await expect(memberPage.getByText('참가가 확정됐어요')).toBeVisible()
  await expect(memberPage.getByRole('button', { name: '신청 취소' })).toBeVisible()
  // 신청 취소 (confirmed) needs a reason before it can be sent.
  await memberPage.getByRole('button', { name: '신청 취소' }).click()
  await expect(memberPage.getByRole('button', { name: '못 간다고 알리기' })).toBeDisabled()
  await memberPage.getByRole('button', { name: '몸이 좋지 않아요' }).click()
  await expect(memberPage.getByRole('button', { name: '못 간다고 알리기' })).toBeEnabled()
  await memberPage.keyboard.press('Escape')
  await memberPage.goto('/#/notifications')
  await expect(memberPage.getByText('활동 일정이 바뀌었어요')).toBeVisible()
  await memberPage.close()
})

test('the organizer cancels with a reason and the member sees it', async ({ page, browser }) => {
  const organizer = await signupByApi(page, '취소 모집자')
  const auth = await tokenFor(page, organizer)
  const created = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '취소될 공원 정리 모임', category: '환경', placeId: 1, date: inDays(3), time: '10:00', capacity: 3, durationMinutes: 60, description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.', safetyConfirmed: true } })
  const id = (await created.json()).id
  const memberPage = await browser.newPage({ baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 } })
  const member = await signupByApi(memberPage, '취소 참가자')
  await memberPage.request.post(`/api/activities/${id}/participations`, { headers: { Authorization: await tokenFor(memberPage, member) } })

  await login(page, organizer)
  await page.goto('/#/manage/' + id)
  // 운영 탭 → 취소 시트: 사유·안내 필수, 확인 체크, 미리보기, 최종 확인.
  await page.getByRole('tab', { name: '운영' }).click()
  await page.getByRole('region', { name: '운영' }).getByRole('button', { name: /활동 취소하기/ }).click()
  const sheet = page.getByRole('dialog', { name: '활동을 취소하시겠어요?' })
  await expect(sheet).toContainText('확정 0명 · 대기 0명 · 승인 대기 1명')
  await expect(sheet.getByRole('button', { name: '취소 사유를 골라 주세요' })).toBeDisabled()
  await sheet.getByText('기상 악화 및 안전 문제').click()
  await expect(sheet.getByRole('textbox')).toHaveValue(/기상 악화로 안전하게 활동하기 어려워/)
  await sheet.getByRole('textbox').fill('내일 강풍 예보가 있어 안전을 위해 취소해요.')
  await expect(sheet.getByLabel('취소 안내 미리보기')).toContainText('기상 악화 및 안전 문제(으)로 취소되었습니다')
  await sheet.getByText('취소로 인해 참가자에게 영향이 생긴다는 점을 확인했어요.').click()
  await sheet.getByRole('button', { name: '다음' }).click()
  const confirm = page.getByRole('dialog', { name: '정말 취소할까요?' })
  await expect(confirm).toContainText('되돌릴 수 없어요')
  await confirm.getByRole('button', { name: '활동 취소 확정' }).click()
  await expect(page.getByText('활동 취소 안내')).toBeVisible()
  await expect(page.getByText('취소 당시 확정 0명 · 대기 0명 · 승인 대기 1명')).toBeVisible()
  await expect(page.getByRole('button', { name: /활동 취소하기/ })).toHaveCount(0)

  await login(memberPage, member)
  await memberPage.goto('/#/notifications')
  await memberPage.getByText('봉사활동이 취소되었어요').click()
  await expect(memberPage).toHaveURL(new RegExp('#/activity/' + id))
  await expect(memberPage.getByText('모집자에 의해 취소됨')).toBeVisible()
  await expect(memberPage.getByText('내일 강풍 예보가 있어 안전을 위해 취소해요.')).toBeVisible()
  await expect(memberPage.getByRole('link', { name: '다른 봉사활동 찾아보기' })).toBeVisible()
  await memberPage.close()
})

test('community: a question, a like and a comment, and a review only after completing an activity', async ({ page, browser }) => {
  const writer = await signupByApi(page, '글쓴 회원')
  await login(page, writer)
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '커뮤니티' }).click()
  // First visit: a nickname and the rules before the board opens.
  await expect(page.getByRole('heading', { name: '커뮤니티를 시작할게요!' })).toBeVisible()
  const nickname = '테스트' + Date.now() % 10000
  await page.getByLabel('닉네임', { exact: true }).fill(nickname)
  await page.getByRole('button', { name: '다음' }).click()
  const rules = page.getByRole('dialog', { name: '커뮤니티 이용 규칙' })
  const start = rules.getByRole('button', { name: '시작하기' })
  await expect(start).toBeDisabled()
  await rules.getByText('이용 규칙을 읽었고 지킬게요').click()
  await start.click()
  await expect(page.getByText('함께하는 봉사 이야기')).toBeVisible()
  await expect(page.getByText('나는 ' + nickname)).toHaveCount(0)
  await page.getByRole('radio', { name: '인기순' }).click()
  await expect(page.getByRole('radio', { name: '인기순' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('link', { name: '글쓰기' }).first().click()
  await page.getByRole('button', { name: '봉사후기' }).click()
  await expect(page.getByText('아직 후기를 쓸 수 있는 활동이 없어요')).toBeVisible()
  await page.getByRole('button', { name: '질문' }).click()
  await page.locator('input[name=title]').fill('주말에 같이 하실 분 구해요')
  await expect(page.getByText('같이 할 사람을 찾고 있나요?')).toBeVisible()
  const title = '첫 봉사 준비물 질문 ' + Date.now() % 100000
  await page.locator('input[name=title]').fill(title)
  await page.locator('textarea[name=body]').fill('연락 주세요 010-1234-5678')
  await page.getByRole('button', { name: '게시글 등록하기' }).click()
  await expect(page.getByText(/연락처는 올릴 수 없어요/).first()).toBeVisible()
  await page.locator('textarea[name=body]').fill('이번 주말 처음 참여하는데 무엇을 챙기면 좋을까요?')
  await page.getByRole('button', { name: '게시글 등록하기' }).click()
  await expect(page).toHaveURL(/#\/post\/\d+$/)
  const postUrl = page.url()

  const reader = await browser.newPage({ baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 } })
  const readerEmail = await signupByApi(reader, '읽는 회원')
  await reader.request.put('/api/community/me', { headers: { Authorization: await tokenFor(reader, readerEmail) }, data: { nickname: '읽는이' + Date.now() % 10000, agree: true } })
  await login(reader, readerEmail)
  await reader.goto(postUrl.slice(postUrl.indexOf('#')).replace(/^/, '/'))
  await reader.getByRole('button', { name: /좋아요 0/ }).click()
  await expect(reader.getByRole('button', { name: /좋아요 1/ })).toBeVisible()
  await reader.getByLabel('댓글 내용').fill('장갑이랑 물 챙기세요!')
  await reader.getByRole('button', { name: '댓글 보내기' }).click()
  await expect(reader.getByText('장갑이랑 물 챙기세요!')).toBeVisible()
  // Someone else's post: the menu offers 신고 (week 7: the button only), not edit or delete.
  await reader.getByRole('button', { name: '글 메뉴', exact: true }).click()
  await expect(reader.getByRole('button', { name: '글 수정' })).toHaveCount(0)
  await reader.getByRole('button', { name: '신고하기' }).click()
  await expect(reader.getByText('신고 기능은 곧 열려요')).toBeVisible()
  await reader.close()

  // The writer fixes the title; the post says 수정됨.
  await page.goto(postUrl.slice(postUrl.indexOf('#')).replace(/^/, '/'))
  await page.getByRole('button', { name: '글 메뉴', exact: true }).click()
  await page.getByRole('button', { name: '글 수정' }).click()
  await page.locator('input[name=title]').fill(title + ' (수정)')
  await page.getByRole('button', { name: '수정 저장하기' }).click()
  await expect(page.getByRole('heading', { name: title + ' (수정)' })).toBeVisible()
  await expect(page.getByText(/수정됨/)).toBeVisible()

  await page.goto('/#/notifications')
  await expect(page.getByText('내 글에 댓글이 달렸어요')).toBeVisible()
  await page.goto('/#/community')
  // The shared dev database keeps posts from earlier runs, so the title is unique.
  await expect(page.getByText(title + ' (수정)')).toBeVisible()
})

test('activity news: the organizer posts a notice from a template, a member asks privately, the organizer answers and sees who read it', async ({ page, browser }) => {
  const organizer = await signupByApi(page, '소식 모집자')
  const auth = await tokenFor(page, organizer)
  const created = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '소식 확인용 공원 정리', category: '환경', placeId: 1, date: inDays(3), time: '10:00', capacity: 3, durationMinutes: 60, description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.', safetyConfirmed: true, meetingPoint: '정문 안내판 앞' } })
  const id = (await created.json()).id
  const memberPage = await browser.newPage({ baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 } })
  const member = await signupByApi(memberPage, '소식 참가자')
  const joined = await (await memberPage.request.post(`/api/activities/${id}/participations`, { headers: { Authorization: await tokenFor(memberPage, member) } })).json()
  await page.request.post(`/api/participations/${joined.participation.id}/approve`, { headers: { Authorization: auth } })

  await login(page, organizer)
  await page.goto('/#/manage/' + id)
  // 소식 tab = the same chat room as 활동 소식, inside 모집 관리.
  await page.getByRole('tab', { name: /소식/ }).click()
  await page.getByRole('button', { name: '집결 장소' }).click()
  await expect(page.getByLabel('공지 내용')).toHaveValue(/정문 안내판 앞에서 10:00에 만나요/)
  await page.getByRole('button', { name: '보내기' }).click()
  await expect(page.getByText('확정 1명 중 0명 읽음')).toBeVisible()

  await login(memberPage, member)
  await memberPage.goto('/#/activity/' + id)
  await expect(memberPage.getByRole('link', { name: /활동 소식.*새 공지 1/ })).toBeVisible()
  await memberPage.getByRole('link', { name: /활동 소식/ }).click()
  await expect(memberPage.getByText('최신 공지')).toBeVisible()
  await memberPage.getByRole('button', { name: '모집자에게만 보이기' }).click()
  await memberPage.getByLabel('질문 내용').fill('무릎이 조금 안 좋은데 천천히 걸어도 될까요?')
  await memberPage.getByRole('button', { name: '보내기' }).click()
  await expect(memberPage.getByText('모집자에게만').first()).toBeVisible()
  await expect(memberPage.getByText('답변을 기다리고 있어요')).toBeVisible()

  await page.reload()
  await page.getByRole('tab', { name: /소식/ }).click()
  // With an unanswered question the organizer lands on the 질문 tab; the read count is under 공지.
  await expect(page.getByRole('tab', { name: /질문/ })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: '공지' }).click()
  await expect(page.getByText('확정 1명 중 1명 읽음')).toBeVisible()
  await page.getByRole('tab', { name: /질문/ }).click()
  await page.getByRole('button', { name: '답변하기' }).click()
  await page.getByRole('button', { name: '네, 괜찮아요!' }).click()
  await page.getByRole('button', { name: '보내기' }).click()
  await expect(page.getByText('내 답변')).toBeVisible()

  await memberPage.goto('/#/notifications')
  await memberPage.getByText('질문에 답변이 달렸어요').click()
  await expect(memberPage).toHaveURL(new RegExp('#/news/' + id))
  await expect(memberPage.getByText('네, 괜찮아요!')).toBeVisible()
  await memberPage.close()
})

test('roll call: a member checks in with the 4-digit code, the organizer checks two others in by hand with one reason', async ({ page, browser }) => {
  const organizer = await signupByApi(page, '출석 모집자')
  const auth = await tokenFor(page, organizer)
  // The admin gives place 1 a coordinate so the location check can pass; the test browser is placed there.
  const adminLogin = await page.request.post('/api/auth/login', { data: { email: 'admin-01@demo.volink.kr', password: env.DEMO_ACCOUNT_PASSWORD } })
  expect(adminLogin.ok()).toBeTruthy()
  const admin = 'Bearer ' + (await adminLogin.json()).accessToken
  await page.request.put('/api/admin/places/1', { headers: { Authorization: admin }, data: { latitude: 37.8156, longitude: 127.0937 } })
  const created = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '출석부 확인용 공원 정리', category: '환경', placeId: 1, date: inDays(3), time: '10:00', capacity: 5, durationMinutes: 60, description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.', safetyConfirmed: true } })
  const id = String((await created.json()).id)
  const members: { email: string; token: string }[] = []
  for (const name of ['코드 참가자', '폰 없는 참가자', 'PC 참가자']) {
    const email = await signupByApi(page, name)
    const token = await tokenFor(page, email)
    const joined = await (await page.request.post(`/api/activities/${id}/participations`, { headers: { Authorization: token } })).json()
    await page.request.post(`/api/participations/${joined.participation.id}/approve`, { headers: { Authorization: auth } })
    members.push({ email, token })
  }
  moveActivity(id, 10)

  await login(page, organizer)
  await page.goto('/#/manage/' + id + '?tab=attendance')
  await expect(page.getByText('출석 코드')).toBeVisible()
  const code = (await page.locator('.r-code').textContent())!.trim()
  expect(code).toMatch(/^\d{4}$/)

  const phone = await browser.newContext({ baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 }, geolocation: { latitude: 37.8156, longitude: 127.0937 }, permissions: ['geolocation'] })
  const memberPage = await phone.newPage()
  await login(memberPage, members[0].email)
  await memberPage.goto('/#/checkin/' + id)
  await memberPage.getByLabel('출석 코드').fill(code)
  await memberPage.getByRole('button', { name: '코드로 체크인' }).click()
  await expect(memberPage.getByRole('heading', { name: /체크인했어요/ })).toBeVisible()
  await phone.close()

  await page.reload()
  await expect(page.locator('.r-tag', { hasText: '코드' })).toBeVisible()
  await page.getByRole('button', { name: '여러 명 선택' }).click()
  const boxes = page.getByRole('checkbox', { name: /선택$/ })
  await expect(boxes).toHaveCount(2)
  await boxes.nth(0).click()
  await boxes.nth(1).click()
  await page.getByRole('button', { name: '2명 출석 처리' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '휴대폰 없음' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '출석 확인' }).click()
  await expect(page.getByText('모두 출석했어요')).toBeVisible()
  await expect(page.locator('.r-tag.man')).toHaveCount(2)
})

test('notification center: chips, three new applications as one card, read on open, then all read', async ({ page }) => {
  const organizer = await signupByApi(page, '알림 모집자')
  const auth = await tokenFor(page, organizer)
  const created = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '알림센터 확인용 공원 정리', category: '환경', placeId: 1, date: inDays(3), time: '10:00', capacity: 5, durationMinutes: 60, description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.', safetyConfirmed: true } })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).id
  for (let i = 0; i < 3; i++) {
    const member = await tokenFor(page, await signupByApi(page, '알림 참가자' + i))
    expect((await page.request.post('/api/activities/' + id + '/participations', { headers: { Authorization: member } })).ok()).toBeTruthy()
  }
  await login(page, organizer)
  await page.goto('/#/notifications')
  const card = page.locator('.m-center-card').filter({ hasText: '새 참가 신청 3건' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('알림센터 확인용 공원 정리')
  await expect(card).toContainText('NEW')
  await expect(page.getByRole('heading', { name: '오늘' })).toBeVisible()
  await expect(page.getByRole('tab', { name: /신청·참여/ })).toContainText('3')
  await page.getByRole('tab', { name: /공지·소통/ }).click()
  await expect(page.getByText('이 종류의 알림이 없어요')).toBeVisible()
  await page.getByRole('tab', { name: /전체/ }).click()
  await card.click()
  await expect(page).toHaveURL(new RegExp('#/manage/' + id))
  await page.goto('/#/notifications')
  await expect(page.locator('.m-center-card').filter({ hasText: '새 참가 신청 3건' })).not.toContainText('NEW')
  await expect(page.getByRole('button', { name: '모두 읽음' })).toBeDisabled()
})

test('after signup: notifications, then night choice; settings: all off, own quiet hours', async ({ page }) => {
  const email = await signupByApi(page, '밤 알림')
  await login(page, email)
  await page.goto('/#/welcome')
  await page.getByRole('button', { name: '나중에 할게요' }).click()
  await page.getByRole('button', { name: '알림 받기' }).click()
  await expect(page.getByRole('heading', { name: /밤에도 알림을/ })).toBeVisible()
  await page.getByRole('button', { name: '밤에도 받을게요' }).click()
  // Last step (V29): how to keep 1365 activities; 직접 남기기 goes home.
  await expect(page.getByRole('heading', { name: '1365 봉사실적도 함께 모을까요?' })).toBeVisible()
  await page.getByRole('button', { name: '괜찮아요, 직접 남길게요' }).click()
  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.getByText('1365 봉사는 직접 남기면 돼요')).toBeHidden({ timeout: 10_000 }) // the toast sits over the switches
  await page.goto('/#/my?view=notice-settings')
  const quiet = page.getByRole('switch', { name: /방해 금지/ })
  await expect(quiet).not.toBeChecked()
  await quiet.check({ force: true })
  await expect(page.getByText('오후 10시 ~ 오전 8시에는 알림을 보내지 않아요')).toBeVisible()
  await page.getByRole('button', { name: /시작/ }).click()
  await page.getByRole('option', { name: '오후 11시' }).click()
  await page.getByRole('button', { name: /로 정하기/ }).click()
  await expect(page.getByText('오후 11시 ~ 오전 8시에는 알림을 보내지 않아요')).toBeVisible()
  await page.getByRole('switch', { name: /휴대폰 알림 받기/ }).uncheck({ force: true })
  await expect(page.getByRole('switch', { name: /신청·참여/ })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('switch', { name: /휴대폰 알림 받기/ })).not.toBeChecked()
  await expect(page.getByText('오후 11시 ~ 오전 8시에는 알림을 보내지 않아요')).toBeVisible()
})

test('find: detail filter with categories, status, source and dates; applied chips; list and map share it', async ({ page }) => {
  const host = await signupByApi(page, '필터 모집자')
  const auth = await tokenFor(page, host)
  const make = async (title: string, category: string) => {
    const response = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title, category, placeId: 1, date: inDays(4), time: '10:00', capacity: 4, durationMinutes: 60, description: '상세 필터로 찾을 수 있는지 확인하는 활동이에요.', safetyConfirmed: true } })
    expect(response.ok()).toBeTruthy()
  }
  const stamp = Date.now() % 100000
  await make(`필터 환경 ${stamp}`, '환경')
  await make(`필터 교육 ${stamp}`, '교육')
  await make(`필터 문화 ${stamp}`, '문화·예술')
  await login(page, host)
  await page.goto('/#/find')
  await page.getByRole('searchbox', { name: '검색어' }).fill(`필터 `)
  await page.getByRole('searchbox', { name: '검색어' }).press('Enter')

  await page.getByRole('button', { name: /^상세 필터/ }).click()
  const sheet = page.getByRole('dialog', { name: '상세 필터' })
  await sheet.getByRole('button', { name: '환경' }).click()
  await sheet.getByRole('button', { name: '교육' }).click()
  await expect(sheet.getByRole('region', { name: /활동 카테고리/ }).getByRole('button', { name: '전체', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await sheet.getByRole('radio', { name: 'Volink' }).click()
  // Volink only: the server counts exactly.
  await expect(sheet.getByRole('button', { name: /개 활동 보기$/ })).toBeVisible()
  // Dates come from our calendar sheet; the end cannot be picked before the start.
  await sheet.getByRole('button', { name: '날짜 직접 선택' }).click()
  await pickDay(page, /^시작일/, inDays(1))
  await pickDay(page, /^종료일/, inDays(6))
  await sheet.getByRole('button', { name: /활동 보기$/ }).click()

  await expect(page.getByText(`필터 환경 ${stamp}`)).toBeVisible()
  await expect(page.getByText(`필터 교육 ${stamp}`)).toBeVisible()
  await expect(page.getByText(`필터 문화 ${stamp}`)).toHaveCount(0)
  const applied = page.getByRole('group', { name: '적용된 조건' })
  await expect(applied.getByRole('button', { name: '환경 조건 지우기' })).toBeVisible()
  await expect(page.getByRole('button', { name: /상세 필터 \(\d+개 적용 중\)/ })).toBeVisible()

  // Same filters on the map; back to the list unchanged.
  await page.getByRole('tab', { name: '지도' }).click()
  // The shared dev database may keep the same activities from earlier runs: same filters, at least these two.
  await expect(page.locator('.m-map-legend')).toContainText(/동네 활동 \d+개/)
  await page.getByRole('tab', { name: '목록' }).click()
  await expect(page.getByText(`필터 환경 ${stamp}`)).toBeVisible()

  // One chip off: only that condition goes.
  await applied.getByRole('button', { name: '환경 조건 지우기' }).click()
  await expect(page.getByText(`필터 환경 ${stamp}`)).toHaveCount(0)
  await expect(page.getByText(`필터 교육 ${stamp}`)).toBeVisible()

  // Closing without applying keeps the applied filters; 초기화 only changes the draft.
  await page.getByRole('button', { name: /^상세 필터/ }).click()
  await sheet.getByRole('button', { name: '초기화' }).click()
  await sheet.getByRole('button', { name: '닫기' }).click()
  await expect(page.getByText(`필터 교육 ${stamp}`)).toBeVisible()
  await expect(applied.getByRole('button', { name: '교육 조건 지우기' })).toBeVisible()

  // Nothing found.
  await page.getByRole('button', { name: /^상세 필터/ }).click()
  await sheet.getByRole('button', { name: '교육' }).click()
  await sheet.getByRole('button', { name: '기타' }).click()
  await sheet.getByRole('button', { name: /활동 보기$/ }).click()
  await expect(page.getByText('조건에 맞는 활동이 없어요')).toBeVisible()
})

test('my → gear: settings, linked account, withdrawal blocked while hosting with applicants, then done', async ({ page }) => {
  const email = await signupByApi(page, '설정 회원')
  const auth = await tokenFor(page, email)
  const hosted = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '탈퇴 전 취소할 활동', category: '환경', placeId: 1, date: inDays(5), time: '10:00', capacity: 3, durationMinutes: 60, description: '탈퇴 전에 먼저 취소해야 하는 활동이에요.', safetyConfirmed: true } })
  const activityId = (await hosted.json()).id
  const guest = await signupByApi(page, '신청한 이웃')
  await page.request.post(`/api/activities/${activityId}/participations`, { headers: { Authorization: await tokenFor(page, guest) }, data: {} })

  await login(page, email)
  await page.goto('/#/my')
  await expect(page.getByText(email)).toBeVisible()
  await page.getByRole('link', { name: '설정' }).click()
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible()
  await page.getByRole('switch', { name: /글자 크게 보기/ }).click()
  await expect(page.locator('html')).toHaveClass(/m-big/)
  await page.getByRole('switch', { name: /글자 크게 보기/ }).click()
  await page.getByRole('link', { name: /연결된 로그인 계정/ }).click()
  await expect(page.getByLabel('로그인 계정').getByText(email)).toBeVisible()
  await page.getByRole('button', { name: '회원 탈퇴' }).click()
  await expect(page.getByText('신청자가 있는 모집 활동이 있어요')).toBeVisible()
  await page.getByText('위 내용을 확인했고 탈퇴할게요.').click()
  await expect(page.getByRole('button', { name: '탈퇴하기' })).toBeDisabled()

  await page.request.post(`/api/activities/${activityId}/cancel`, { headers: { Authorization: auth }, data: { reasonCode: 'PERSONAL', message: '탈퇴하려고 취소합니다.' } })
  await page.getByRole('button', { name: '돌아가기' }).click()
  await page.getByRole('button', { name: '회원 탈퇴' }).click()
  await expect(page.getByText('신청자가 있는 모집 활동이 있어요')).toHaveCount(0)
  await page.getByText('위 내용을 확인했고 탈퇴할게요.').click()
  await page.getByRole('button', { name: '탈퇴하기' }).click()
  await expect(page).toHaveURL(/#\/login$/)
  const again = await page.request.post('/api/auth/login', { data: { email, password } })
  expect(again.status()).toBe(401)
})

test('1365: a marked activity → went → certificate PDF read on the phone → review; the lab reads a pasted 1365 list', async ({ page, browser }) => {
  const member = await signupByApi(page, '1365 참가자')
  const auth = await tokenFor(page, member)
  const yesterday = inDays(-1)
  const created = await page.request.post('/api/me/external', { headers: { Authorization: auth }, data: { programNo: 'P123456', title: '노인복지관 배식 지원', organization: '양주시자원봉사센터', place: '양주시 옥정동', date: yesterday, startTime: '11:00', endTime: '13:00' } })
  expect(created.status()).toBe(201)
  const id = (await created.json()).id
  await login(page, member)

  // 내 활동 → the 1365 row asks "다녀왔어요?"; the record screen marks it.
  await page.goto('/#/mine')
  await expect(page.getByRole('link', { name: /노인복지관 배식 지원.*다녀왔어요\?/ })).toBeVisible()
  await page.goto('/#/record/' + id)
  await page.getByRole('button', { name: '다녀왔어요', exact: true }).click()
  await expect(page.getByText('다녀왔다고 남겼어요')).toBeVisible()

  // A certificate PDF made here (Korean text) is read on the page; only the values are sent.
  const maker = await browser.newPage()
  await maker.setContent(`<html><body style="font-family:'WenQuanYi Zen Hei'"><h1>봉사활동 확인서</h1><p>봉사활동명: 노인복지관 배식 지원</p><p>수요처: 양주시자원봉사센터</p><p>활동일: ${yesterday.replaceAll('-', '.')}</p><p>봉사시간: 2시간 30분</p></body></html>`)
  const pdf = await maker.pdf()
  await maker.close()
  await page.getByRole('button', { name: /1365 실적확인서 올리기/ }).click()
  await page.locator('input[type=file][accept="application/pdf"]').setInputFiles({ name: 'certificate.pdf', mimeType: 'application/pdf', buffer: pdf })
  const check = page.getByRole('dialog', { name: '이 내용이 맞나요?' })
  await expect(check.getByLabel('활동명')).toHaveValue('노인복지관 배식 지원')
  await expect(check.getByLabel('기관')).toHaveValue('양주시자원봉사센터')
  await expect(check.getByRole('button', { name: /^날짜/ })).toContainText(`${Number(yesterday.slice(5, 7))}월 ${Number(yesterday.slice(8))}일`)
  await expect(check.getByLabel('인정 시간(분)')).toHaveValue('150')
  await check.getByRole('button', { name: '맞아요, 남길게요' }).click()
  await expect(page.getByText('실적확인서 있음').first()).toBeVisible()

  // Review about it: the 1365 record is picked, the post says 본인 기록 / 실적확인서 있음 (never 참여 확인).
  await page.request.put('/api/community/me', { headers: { Authorization: auth }, data: { nickname: '배식' + Math.floor(Math.random() * 9000 + 1000), agree: true } })
  await page.getByRole('link', { name: /사진과 함께 후기 쓰기/ }).click()
  await expect(page.getByRole('button', { name: /1365 노인복지관 배식 지원/ })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('input[name=title]').fill('배식 봉사 다녀왔어요')
  await page.locator('textarea[name=body]').fill('어르신들이 반겨 주셔서 좋았어요.')
  await page.getByRole('button', { name: '게시글 등록하기' }).click()
  await expect(page.getByText('함께한 1365 봉사')).toBeVisible()
  await expect(page.getByText('Volink가 확인한 기록은 아니에요')).toBeVisible()

  // Lab (off by default): on in 설정 › 실험실; without the app the 1365 list text can be pasted.
  await page.goto('/#/settings')
  await page.getByRole('switch', { name: /1365 연결/ }).click()
  await page.getByRole('link', { name: /1365 신청 내역 가져오기/ }).click()
  await page.getByPlaceholder(/1365 신청 현황/).fill(`나의 봉사 신청 현황\n하천 정화 활동\n${inDays(5).replaceAll('-', '.')} 09:00~11:00 승인완료\n도서관 정리 도우미 ${inDays(-3).replaceAll('-', '.')} 10:00~12:00 활동완료`)
  await page.getByRole('button', { name: '붙여 넣은 글자 읽기' }).click()
  await expect(page.getByRole('heading', { name: '신청 내역 2개를 찾았어요' })).toBeVisible()
  await expect(page.getByText(/하천 정화 활동/)).toBeVisible()
  await page.getByRole('button', { name: '2개 내 활동에 넣기' }).click()
  await expect(page).toHaveURL(/#\/mine/)
  await expect(page.getByRole('link', { name: /하천 정화 활동/ })).toBeVisible()

  // The 1365 봉사참여 실적 page: total time, count and time per field (the name on that page is not kept).
  await page.goto('/#/lab1365')
  await page.getByPlaceholder(/1365 신청 현황/).fill('봉사참여 실적\n실적확인서 발행 내역\n시간인증형\n활동인증형\n홍길동 님의 시간인증형 봉사시간\n총 57시간 30분\n시간인증형 자원봉사 참여\n총 14건\n분야별 봉사시간 조회\n봉사분야\t봉사시간\n기타\t57시간 30분')
  await page.getByRole('button', { name: '붙여 넣은 글자 읽기' }).click()
  await expect(page.getByRole('heading', { name: '1365 봉사 실적을 찾았어요' })).toBeVisible()
  await expect(page.getByText('봉사 실적 총 57시간 30분 · 14건')).toBeVisible()
  await expect(page.getByText('기타 57시간 30분')).toBeVisible()
  await page.getByRole('button', { name: '실적 가져오기' }).click()
  // 완료 기록 (B): 함께한 시간 = 1365 + Volink, the 1365 refresh row, and chips over one list.
  const total = page.getByRole('region', { name: '함께한 시간' })
  await expect(total).toContainText('1365 57시간 30분 (공식 실적)')
  await expect(total).not.toContainText('홍길동')
  await expect(page.getByRole('button', { name: /1365 연결됨.*새로고침/ })).toBeVisible()
  await page.getByRole('radio', { name: /^Volink/ }).click()
  await expect(page.getByRole('link', { name: /하천 정화 활동/ })).toHaveCount(0)
  await page.getByRole('radio', { name: /^1365/ }).click()
  await expect(page.getByRole('link', { name: /도서관 정리 도우미/ })).toBeVisible()
})

test('1365 connect: an empty 완료 기록 offers it, a consent sheet first, then the 3-step guide; 마이 shows Volink + 1365', async ({ page }) => {
  const member = await signupByApi(page, '연결 확인')
  await login(page, member)
  await page.goto('/#/mine?tab=done')
  await expect(page.getByText('아직 완료 기록이 없어요')).toBeVisible()
  await page.getByRole('button', { name: '1365 실적 연결' }).click()
  const sheet = page.getByRole('dialog', { name: '연결 전에 확인해 주세요' })
  await expect(sheet).toContainText('비밀번호는 Volink로 오지 않아요')
  await sheet.getByRole('button', { name: '동의하고 계속하기' }).click()
  await expect(page).toHaveURL(/#\/lab1365/)
  await expect(page.getByRole('heading', { name: '이렇게 가져와요' })).toBeVisible()
  await expect(page.getByText('☰ 메뉴 › 나의 봉사', { exact: true })).toBeVisible()
  // Before any 1365 total, 마이 offers the connection; after one, the total adds both.
  await page.goto('/#/my')
  await expect(page.getByRole('button', { name: /1365 봉사실적 연결하기/ })).toBeVisible()
  await page.request.put('/api/me/external/summary', { headers: { Authorization: await tokenFor(page, member) }, data: { totalMinutes: 3450, count: 14, fields: [{ name: '기타', minutes: 3450 }] } })
  await page.reload()
  const total = page.getByRole('region', { name: '함께한 시간' })
  await expect(total).toContainText('57시간 30분')
  await expect(total).toContainText('1365 57시간 30분 + Volink 0시간')
  await expect(total).toContainText('1365 공식 실적')
  await expect(page.getByRole('button', { name: /1365 연결됨/ })).toBeVisible()
})

test('1365 가져오기: chosen after signup; a past 1365 activity waits, a larger 1365 count marks it 실적 반영됨(추정); 마이 adds both', async ({ page }) => {
  const member = await signupByApi(page, '가져오기')
  await login(page, member)
  await page.goto('/#/welcome')
  await page.getByRole('button', { name: '나중에 할게요' }).click()
  await page.getByRole('button', { name: '나중에 할게요' }).click()
  await page.getByRole('button', { name: '1365 연결하기' }).click()
  await page.getByRole('dialog', { name: '연결 전에 확인해 주세요' }).getByRole('button', { name: '동의하고 계속하기' }).click()
  await expect(page).toHaveURL(/#\/lab1365/)
  const auth = await tokenFor(page, member)
  await page.request.put('/api/me/external/summary', { headers: { Authorization: auth }, data: { totalMinutes: 3450, count: 14 } })
  const created = await page.request.post('/api/me/external', { headers: { Authorization: auth }, data: { title: '노인복지관 배식 지원', date: inDays(-4), startTime: '11:00', endTime: '13:00' } })
  const id = (await created.json()).id
  await page.goto('/#/mine')
  await expect(page.getByRole('link', { name: /노인복지관 배식 지원.*실적 확인 대기/ })).toBeVisible()
  await page.goto('/#/record/' + id)
  await expect(page.getByText('실적 확인 대기').first()).toBeVisible()
  await page.getByRole('button', { name: '실적 새로고침' }).click()
  await expect(page).toHaveURL(/#\/lab1365/)
  await page.getByPlaceholder(/1365 신청 현황/).fill('봉사참여 실적\n시간인증형\n총 59시간 30분\n총 15건')
  await page.getByRole('button', { name: '붙여 넣은 글자 읽기' }).click()
  await page.getByRole('button', { name: '실적 가져오기' }).click()
  await expect(page.getByText('실적이 늘었어요 14→15건')).toBeVisible()
  await page.goto('/#/record/' + id)
  await expect(page.getByText('1365 실적 건수가 늘어서')).toBeVisible()
  await page.goto('/#/my')
  await expect(page.getByRole('region', { name: '함께한 시간' })).toContainText('1365 59시간 30분 + Volink 0시간')
  await page.goto('/#/settings')
  await expect(page.getByRole('button', { name: /1365 기록 방식.*가져오기/ })).toBeVisible()
})

test('1365 step guide: the words on the page tell which step the person is on (① 로그인 … ④ 이 화면 가져오기)', async ({ page }) => {
  await page.goto('/#/login')
  const steps = await page.evaluate(async () => {
    const { labStep } = await import('/src/app/lab.tsx' as string)
    const sum = '로그아웃 봉사참여 실적 홍길동 님 총 57시간 30분 총 14건', app = '로그아웃 나의 봉사 신청 현황 하천 정화 2026.11.12 승인완료'
    return [
      labStep('1365 로그인 아이디 비밀번호', true), labStep('봉사찾기 로그인 회원가입', false), labStep('홈 로그아웃 봉사찾기 공지사항', false),
      labStep('로그아웃 나의 봉사 봉사참여 실적 신청 현황 실적확인서', false), labStep(sum, false), labStep(app, false),
      // 2026-11-06 device: the 실적 page wins over a (hidden) login form; one page per visit, the other page points back.
      labStep(sum, true, false, false, '', false, 'S'), labStep(sum, false, false, false, '', false, 'A'), labStep(app, false, false, false, '', false, 'S'),
      // '로그아웃' only in the closed ☰ menu (textContent), or the login page was just left.
      labStep('1365 자원봉사포털 검색어를 입력하세요 청소년 성인', false, false, false, '메뉴 홍길동님 로그아웃 나의 봉사'), labStep('1365 자원봉사포털 검색어', false, false, false, '', true),
    ].map(x => x.step + x.kind)
  })
  expect(steps).toEqual(['1-', '1-', '2-', '3-', '4S', '4A', '4S', '3-', '3-', '2-', '2-'])
})

test('1365 신청 현황 as the page shows it: titles are not 봉사기간, 모집기간 is skipped, a period asks for the day, no time = 시간 미정', async ({ page }) => {
  const member = await signupByApi(page, '기간 확인')
  await login(page, member)
  const dot = (n: number) => inDays(n).replaceAll('-', '.')
  await page.goto('/#/settings')
  await page.getByRole('switch', { name: /1365 연결/ }).click()
  await page.goto('/#/lab1365')
  await page.getByPlaceholder(/1365 신청 현황/).fill(`나의 봉사 신청 현황\n어르신 말벗 봉사\n봉사기간 ${dot(3)} ~ ${dot(20)}\n모집기간 ${dot(-5)} ~ ${dot(2)}\n승인완료\n하천 정화 활동\n봉사기간 ${dot(6)} ~ ${dot(6)}\n신청완료`)
  await page.getByRole('button', { name: '붙여 넣은 글자 읽기' }).click()
  await expect(page.getByRole('heading', { name: '신청 내역 2개를 찾았어요' })).toBeVisible()
  await expect(page.getByText('봉사기간', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '참여하는 날을 골라 주세요 (1개)' })).toBeDisabled()
  await pickDay(page, /어르신 말벗 봉사 · 참여하는 날/, inDays(10))
  await page.getByRole('button', { name: '2개 내 활동에 넣기' }).click()
  await expect(page).toHaveURL(/#\/mine/)
  await expect(page.getByRole('link', { name: /어르신 말벗 봉사.*시간 미정/ })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp('어르신 말벗 봉사.*' + inDays(10).slice(5).replace('-', '/')) })).toBeVisible()
})

test('a bottom sheet closes when dragged down like ✕, and springs back on a short drag', async ({ page }) => {
  const member = await signupByApi(page, '쓸어내리기')
  await login(page, member)
  await page.goto('/#/settings')
  const cdp = await page.context().newCDPSession(page)
  const drag = async (from: number, to: number) => {
    const box = (await page.locator('.m-sheet-head').boundingBox())!
    const x = box.x + box.width / 2, y = box.y + box.height / 2
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y + from }] })
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + from + (to - from) * i / 8 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  }
  await page.getByRole('button', { name: '로그아웃' }).click()
  const sheet = page.getByRole('dialog', { name: '로그아웃할까요?' })
  await expect(sheet).toBeVisible()
  await drag(0, 40)
  await page.waitForTimeout(400)
  await expect(sheet).toBeVisible()
  await drag(0, 260)
  await expect(sheet).toHaveCount(0)
  await expect(page).toHaveURL(/#\/settings/)
})

test('글쓰기 •••: 임시 저장, 미리보기, 처음부터 다시 쓰기, 이용 규칙', async ({ page }) => {
  const member = await signupByApi(page, '메뉴 확인')
  const auth = await tokenFor(page, member)
  await page.request.put('/api/community/me', { headers: { Authorization: auth }, data: { nickname: '메뉴' + Math.floor(Math.random() * 9000 + 1000), agree: true } })
  await login(page, member)
  await page.goto('/#/write')
  await expect(page.getByRole('button', { name: '등록', exact: true })).toHaveCount(0)
  await page.locator('input[name=title]').fill('같이 하실 분 구해요')
  await page.locator('textarea[name=body]').fill('주말에 하천 정화 같이 해요.')
  await page.getByRole('button', { name: '글쓰기 메뉴' }).click()
  await page.getByRole('dialog', { name: '글쓰기 메뉴' }).getByRole('button', { name: /^임시 저장/ }).click()
  await expect(page.getByText('임시 저장했어요')).toBeVisible()
  await page.getByRole('button', { name: '글쓰기 메뉴' }).click()
  await page.getByRole('button', { name: /미리보기/ }).click()
  const preview = page.getByRole('dialog', { name: '미리보기' })
  await expect(preview.getByRole('heading', { name: '같이 하실 분 구해요' })).toBeVisible()
  await expect(preview.getByRole('button', { name: '이대로 올리기' })).toBeEnabled()
  await preview.getByRole('button', { name: '닫기' }).click()
  await page.reload()
  await expect(page.locator('input[name=title]')).toHaveValue('같이 하실 분 구해요')
  await page.getByRole('button', { name: '글쓰기 메뉴' }).click()
  await page.getByRole('button', { name: /커뮤니티 이용 규칙/ }).click()
  await expect(page.getByText('연락처는 올릴 수 없어요.')).toBeVisible()
  await page.getByRole('dialog', { name: '커뮤니티 이용 규칙' }).getByRole('button', { name: '닫기' }).click()
  await page.getByRole('button', { name: '글쓰기 메뉴' }).click()
  await page.getByRole('button', { name: /처음부터 다시 쓰기/ }).click()
  await page.getByRole('button', { name: '비우기' }).click()
  await expect(page.locator('input[name=title]')).toHaveValue('')
})

test('search: a 1365 result opens that program, not the 찾기 list; the lab offers an example that is never saved', async ({ page }) => {
  const member = await signupByApi(page, '검색 상세')
  await login(page, member)
  await page.route('**/api/volunteer-programs**', route => route.fulfill({ json: { enabled: true, items: [{ programNo: 'S-1', title: '유기견 보호소 산책 도우미', organization: '인천 보호소', place: '인천광역시 연수구', field: '동물', periodStart: inDays(2), periodEnd: inDays(20), beginTime: '10:00', endTime: '12:00', weekdays: null, recruitStatus: '모집중', recruitEnd: null, capacity: 5, youthOk: true, latitude: null, longitude: null, distanceKm: null, link: 'https://www.1365.go.kr', category: '동물', categoryBasis: 'OFFICIAL' }] } }))
  await page.goto('/#/search?q=' + encodeURIComponent('유기견'))
  await page.getByRole('tab', { name: '봉사활동' }).click()
  await page.getByRole('button', { name: /유기견 보호소 산책 도우미/ }).click()
  const sheet = page.getByRole('dialog', { name: '1365 활동' })
  await expect(sheet.getByRole('heading', { name: '유기견 보호소 산책 도우미' })).toBeVisible()
  await expect(sheet.getByRole('link', { name: /1365에서 신청하기/ })).toBeVisible()
  await expect(page).toHaveURL(/#\/search/)
  await page.unroute('**/api/volunteer-programs**')

  await page.goto('/#/lab1365')
  await page.getByRole('button', { name: /예시로 해보기/ }).click()
  await expect(page.getByText('예시 화면 · 저장되지 않아요')).toBeVisible()
  await expect(page.getByRole('heading', { name: '신청 내역 2개를 찾았어요' })).toBeVisible()
  await pickDay(page, /어르신 말벗 봉사 \(예시\) · 참여하는 날/, inDays(10))
  await page.getByRole('button', { name: '예시 확인 끝 (저장 안 함)' }).click()
  await expect(page.getByText('예시라 저장하지 않았어요')).toBeVisible()
  const auth = await tokenFor(page, member)
  expect((await (await page.request.get('/api/me/external', { headers: { Authorization: auth } })).json()).length).toBe(0)
})
