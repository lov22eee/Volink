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
  const response = await page.request.post('/api/auth/signup', { data: { memberType: 'GENERAL', name, email, password, birthDate: '2000-01-01', interests: ['환경 정화'], agreedNotice: true } })
  expect(response.ok()).toBeTruthy()
  return email
}

async function login(page: Page, email: string) {
  await page.goto('/#/login')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).toHaveURL(/#\/home$/)
}

async function tokenFor(page: Page, email: string) {
  const response = await page.request.post('/api/auth/login', { data: { email, password } })
  return 'Bearer ' + (await response.json()).accessToken
}

test('nothing is shown before signing in, and signup has three steps without an institution choice', async ({ page }) => {
  await page.goto('/#/find')
  await expect(page.getByRole('button', { name: '로그인', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: '주요 메뉴' })).toHaveCount(0)
  await page.getByRole('link', { name: '회원가입' }).click()
  await expect(page.getByText('기관 가입은 PC에서 진행해 주세요.')).toBeVisible()
  const next = page.getByRole('button', { name: '다음' })
  await page.getByPlaceholder('example@email.com').fill(unique('signup'))
  await page.getByLabel('비밀번호', { exact: true }).fill('abcdefgh')
  await expect(next).toBeDisabled()
  await page.getByLabel('비밀번호', { exact: true }).fill('abcd1234')
  await page.getByLabel('비밀번호 확인').fill('abcd1234')
  await next.click()
  await page.getByPlaceholder('이름').fill('앱 회원')
  await page.getByRole('button', { name: /^생년월일/ }).click()
  await page.getByRole('option', { name: '2003년' }).click()
  await page.getByRole('button', { name: '완료' }).click()
  await page.getByRole('button', { name: '환경 정화' }).click()
  await next.click()
  await expect(page.getByText('기관 회원', { exact: true })).toHaveCount(0)
  await page.getByText('모두 동의').click()
  await page.getByRole('button', { name: '가입하고 시작하기' }).click()
  await expect(page).toHaveURL(/#\/home$/)
  await expect(page.getByRole('heading', { name: '앱 회원님, 반가워요' })).toBeVisible()
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
  const dialog = page.getByRole('dialog', { name: '장소 찾기' })
  await dialog.getByRole('button', { name: /옥정중앙공원/ }).click()
  await dialog.getByRole('button', { name: '이 장소로 정하기' }).click()
  await expect(dialog).toHaveCount(0)
  await page.locator('textarea[name=description]').fill('공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.')
  await page.getByRole('button', { name: '다음' }).click()
  await page.getByRole('button', { name: '한 명 줄이기' }).click()
  await page.getByRole('button', { name: '모집 시작하기' }).click()
  await expect(page.getByText(/안전 안내를 확인/)).toBeVisible()
  await page.locator('input[name=safety]').check({ force: true })
  await page.getByRole('button', { name: '모집 시작하기' }).click()
  await expect(page.getByRole('heading', { name: '모집을 시작했어요!' })).toBeVisible()
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
  await page.getByRole('button', { name: '승인' }).click()
  await expect(page.getByText('참가 확정').first()).toBeVisible()
  await page.getByRole('button', { name: '활동 메뉴' }).click()
  await page.getByRole('button', { name: /일정 바꾸기/ }).click()
  await page.getByRole('button', { name: /^시작/ }).click()
  await page.getByRole('option', { name: '오후 2시' }).click()
  await page.getByRole('button', { name: /14:00 시작/ }).click()
  await page.getByPlaceholder(/장소 사정/).fill('오전에 행사가 있어 오후로 옮겨요')
  await page.getByRole('button', { name: '바꾸고 알리기' }).click()
  await expect(page.getByText(/14:00/).first()).toBeVisible()

  await memberPage.reload()
  await expect(memberPage.getByText('참가가 확정됐어요')).toBeVisible()
  await expect(memberPage.getByRole('button', { name: '못 가요' })).toBeVisible()
  await memberPage.goto('/#/notifications')
  await expect(memberPage.getByText('활동 일정이 바뀌었어요')).toBeVisible()
  await memberPage.close()
})

test('the organizer cancels with a reason and the member sees it', async ({ page, browser }) => {
  const organizer = await signupByApi(page, '취소 모집자')
  const auth = await tokenFor(page, organizer)
  const created = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '취소될 공원 정리 모임', category: '환경 정화', placeId: 1, date: inDays(3), time: '10:00', capacity: 3, durationMinutes: 60, description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.', safetyConfirmed: true } })
  const id = (await created.json()).id
  const memberPage = await browser.newPage({ baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 } })
  const member = await signupByApi(memberPage, '취소 참가자')
  await memberPage.request.post(`/api/activities/${id}/participations`, { headers: { Authorization: await tokenFor(memberPage, member) } })

  await login(page, organizer)
  await page.goto('/#/manage/' + id)
  await page.getByRole('button', { name: '활동 메뉴' }).click()
  await page.getByRole('button', { name: /활동 취소/ }).click()
  await page.getByRole('button', { name: '비 예보가 있어요' }).click()
  await page.getByRole('button', { name: '활동 취소하기' }).click()
  await expect(page.getByText('취소한 활동이에요')).toBeVisible()

  await login(memberPage, member)
  await memberPage.goto('/#/activity/' + id)
  await expect(memberPage.getByText('모집자가 활동을 취소했어요')).toBeVisible()
  await expect(memberPage.getByText('비 예보가 있어요')).toBeVisible()
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
  await expect(page.getByText('나는 ' + nickname)).toBeVisible()
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
  await page.getByRole('button', { name: '올리기' }).click()
  await expect(page.getByText(/연락처는 올릴 수 없어요/).first()).toBeVisible()
  await page.locator('textarea[name=body]').fill('이번 주말 처음 참여하는데 무엇을 챙기면 좋을까요?')
  await page.getByRole('button', { name: '올리기' }).click()
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
  await reader.close()

  await page.goto('/#/notifications')
  await expect(page.getByText('내 글에 댓글이 달렸어요')).toBeVisible()
  await page.goto('/#/community')
  // The shared dev database keeps posts from earlier runs, so the title is unique.
  await expect(page.getByText(title)).toBeVisible()
})

test('activity news: the organizer posts a notice from a template, a member asks privately, the organizer answers and sees who read it', async ({ page, browser }) => {
  const organizer = await signupByApi(page, '소식 모집자')
  const auth = await tokenFor(page, organizer)
  const created = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '소식 확인용 공원 정리', category: '환경 정화', placeId: 1, date: inDays(3), time: '10:00', capacity: 3, durationMinutes: 60, description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.', safetyConfirmed: true, meetingPoint: '정문 안내판 앞' } })
  const id = (await created.json()).id
  const memberPage = await browser.newPage({ baseURL: 'http://127.0.0.1:5174', viewport: { width: 390, height: 844 } })
  const member = await signupByApi(memberPage, '소식 참가자')
  const joined = await (await memberPage.request.post(`/api/activities/${id}/participations`, { headers: { Authorization: await tokenFor(memberPage, member) } })).json()
  await page.request.post(`/api/participations/${joined.participation.id}/approve`, { headers: { Authorization: auth } })

  await login(page, organizer)
  await page.goto('/#/manage/' + id)
  await page.getByRole('link', { name: '공지 올리기' }).click()
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
  const created = await page.request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title: '출석부 확인용 공원 정리', category: '환경 정화', placeId: 1, date: inDays(3), time: '10:00', capacity: 5, durationMinutes: 60, description: '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.', safetyConfirmed: true } })
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
