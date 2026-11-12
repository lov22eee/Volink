import { test, expect } from '@playwright/test'
import type { APIRequestContext, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// PC 화면 (2026-11-11): public pages, 기관센터 and the admin console. Personal members use the app (app.spec.ts).
const env = Object.fromEntries(readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter(row => row.includes('=') && !row.startsWith('#')).map(row => [row.slice(0, row.indexOf('=')), row.slice(row.indexOf('=') + 1).trim()]))
const password = 'example123'
const admin = 'admin-01@demo.volink.kr'
const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`
const inDays = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 86_400_000))
const body = '공원 산책로를 천천히 걸으며 쓰레기를 함께 줍는 가벼운 활동이에요.'

async function token(api: APIRequestContext, email: string, pass = password) {
  const response = await api.post('/api/auth/login', { data: { email, password: pass } })
  expect(response.ok()).toBeTruthy()
  return 'Bearer ' + (await response.json()).accessToken
}
async function person(api: APIRequestContext, name: string) {
  const email = unique('pc-member')
  expect((await api.post('/api/auth/signup', { data: { memberType: 'GENERAL', name, email, password, birthDate: '2000-01-01', interests: ['환경'], agreedNotice: true } })).ok()).toBeTruthy()
  return email
}
async function signIn(page: Page, email: string, pass = password) {
  await page.goto('/#/login')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(pass)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
}

test('anyone browses open posts, a post page offers the app instead of applying, and nothing scrolls sideways on a phone', async ({ page, request }) => {
  const organizer = await token(request, await person(request, 'PC 공개 모집자'))
  const title = 'PC 공개 확인 정리 ' + Math.floor(Math.random() * 1e5)
  const created = await request.post('/api/activities', { headers: { Authorization: organizer }, data: { activityType: 'GENERAL', title, category: '환경', placeId: 1, date: inDays(5), time: '10:00', capacity: 4, durationMinutes: 60, description: body, safetyConfirmed: true } })
  expect(created.ok()).toBeTruthy()
  await page.goto('/#/')
  await expect(page.getByRole('heading', { name: /앱 하나로/ })).toBeVisible()
  await expect(page.getByRole('link', { name: '앱 받기' }).first()).toHaveAttribute('href', /\/download\/volink\.apk$/)
  await expect(page.getByRole('img', { name: '앱 받기 QR 코드' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Volink로 할 수 있는 것' })).toBeVisible()
  await expect(page.getByRole('region', { name: '지금 모집 중' }).locator('.pc-acard').first()).toBeVisible()
  await expect(page.getByRole('link', { name: '기관 가입 신청' })).toHaveAttribute('href', '#/org/signup')
  await page.getByRole('link', { name: '기관 로그인' }).click()
  await expect(page.getByRole('heading', { name: /PC에서 한 번에 관리하세요/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: '기관 로그인' })).toBeVisible()
  await page.goto('/#/activity/' + (await created.json()).id)
  await expect(page.getByRole('heading', { name: title })).toBeVisible()
  await expect(page.getByText('신청은 앱에서 해요')).toBeVisible()
  await expect(page.getByText('4자리 남음')).toBeVisible()
  await expect(page.getByRole('img', { name: '앱 받기 QR 코드' })).toBeVisible()
  await expect(page.getByRole('button', { name: /신청하기/ })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/졸업작품|경동대학교|주차|발표|페르소나/)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const hash of ['#/', '#/login', '#/org', '#/org/signup']) {
    await page.goto('/' + hash)
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy()
  }
})

test('the list says so when the server cannot be reached, without made-up posts', async ({ page, request }) => {
  await page.route('**/api/activities', route => route.abort())
  await page.goto('/#/')
  await expect(page.getByText('모집 목록을 불러오지 못했어요')).toBeVisible()
  await expect(page.locator('.pc-acard')).toHaveCount(0)
})

test('a personal account on the PC is pointed to the app and can log out', async ({ page, request }) => {
  await signIn(page, await person(request, 'PC 개인'))
  await expect(page).toHaveURL(/#\/app$/)
  await expect(page.getByRole('heading', { name: /Volink 앱에서 할 수 있어요/ })).toBeVisible()
  await page.goto('/#/org')
  await expect(page.getByRole('heading', { name: /Volink 앱에서 할 수 있어요/ })).toBeVisible()
  await page.goto('/#/admin')
  await expect(page.getByRole('heading', { name: /Volink 앱에서 할 수 있어요/ })).toBeVisible()
  await page.getByRole('button', { name: '로그아웃' }).first().click()
  await expect(page.getByRole('link', { name: '로그인', exact: true })).toBeVisible()
})

test('기관: sign up on the PC, wait for the check, the admin approves from 할 일 with a reason, then 기관센터 approves applicants in one go', async ({ page, browser, request }) => {
  const email = unique('pc-org')
  const orgName = 'PC 확인 센터 ' + Math.floor(Math.random() * 1e5)
  await page.goto('/#/org/signup')
  await page.getByRole('button', { name: '가입 신청하기' }).click()
  await expect(page.getByText('기관 유형을 골라 주세요.')).toBeVisible()
  await page.getByLabel('기관 유형').selectOption('NONPROFIT')
  await page.getByLabel('기관명').fill(orgName)
  await page.getByLabel('대표 연락처').fill('031-123-4567')
  await page.getByLabel('담당자 이름').fill('김담당')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel(/^비밀번호/).first().fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: '가입 신청하기' }).click()
  await expect(page.getByRole('heading', { name: '기관 확인을 기다리고 있어요' })).toBeVisible()

  // The admin's 할 일: open this organization, a rejection needs a reason, then approve.
  const adminPage = await (await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 1000 } })).newPage()
  await signIn(adminPage, admin, env.DEMO_ACCOUNT_PASSWORD)
  await expect(adminPage).toHaveURL(/#\/admin$/)
  await adminPage.getByRole('link', { name: /할 일/ }).click()
  await adminPage.getByRole('button', { name: new RegExp(orgName) }).click()
  const decide = adminPage.getByRole('region', { name: '처리', exact: true })
  await expect(decide.getByRole('heading', { name: orgName })).toBeVisible()
  await decide.getByRole('radio', { name: '반려' }).check()
  await decide.getByRole('button', { name: '처리하고 다음 건' }).click()
  await expect(decide.getByRole('alert')).toContainText('사유')
  await decide.getByRole('radio', { name: '승인' }).check()
  await decide.getByLabel(/사유/).fill('기관 정보 확인 완료')
  await decide.getByRole('button', { name: '처리하고 다음 건' }).click()
  await expect(adminPage.getByRole('button', { name: new RegExp(orgName) })).toHaveCount(0)
  // The log keeps it with the reason.
  await adminPage.goto('/#/admin/log?type=ORGANIZATION')
  await expect(adminPage.getByRole('row', { name: new RegExp(orgName) }).first()).toContainText('기관 정보 확인 완료')

  // 기관센터: two applications wait; both are approved at once.
  await page.getByRole('button', { name: '다시 확인' }).click()
  await expect(page.getByRole('link', { name: '할 일' })).toBeVisible()
  const auth = await token(request, email)
  const title = '기관 일괄 승인 확인 ' + Math.floor(Math.random() * 1e5)
  const created = await request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'INSTITUTION', title, category: '지역사회', placeId: 1, date: inDays(6), time: '10:00', capacity: 5, durationMinutes: 120, description: body, safetyConfirmed: true } })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).id
  for (const name of ['일괄 하나', '일괄 둘']) expect((await request.post(`/api/activities/${id}/participations`, { headers: { Authorization: await token(request, await person(request, name)) } })).ok()).toBeTruthy()
  await page.reload()
  await expect(page.getByRole('row', { name: new RegExp(title) }).first()).toContainText('신청 2명이 승인을 기다려요')
  await page.getByRole('row', { name: new RegExp(title) }).first().getByRole('link', { name: '승인하기' }).click()
  await page.getByRole('checkbox', { name: '모두 고르기' }).check()
  await page.getByRole('button', { name: '2명 승인' }).click()
  await expect(page.getByRole('status')).toContainText('2명을 확정했어요')
  await expect(page.getByText('2 / 5명')).toBeVisible()
  // The public page of the organizer's own post opens it in 기관센터.
  await page.goto('/#/activity/' + id)
  await expect(page).toHaveURL(new RegExp('#/org/activity/' + id))
})

test('admin: a post waiting for review stays hidden until it is approved in 할 일; 현황, 찾기 and 장소 answer', async ({ page, request }) => {
  const email = await person(request, 'PC 검토 모집자')
  const auth = await token(request, email)
  const title = '하천변 야간 정리 ' + Math.floor(Math.random() * 1e5)
  const created = await request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'GENERAL', title, category: '환경', placeId: 1, date: inDays(5), time: '10:00', capacity: 4, durationMinutes: 60, description: body, safetyConfirmed: true } })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).id
  expect((await (await request.get('/api/activities')).json() as { id: number }[]).some(a => a.id === id)).toBeFalsy()
  await signIn(page, admin, env.DEMO_ACCOUNT_PASSWORD)
  // The dashboard: the 모집글 검토 card opens the oldest post waiting for review in a drawer, Esc closes it.
  const card = page.getByRole('button', { name: /모집글 검토 \d+건 처리하기/ })
  await expect(card).toBeVisible()
  await expect(page.getByRole('region', { name: '지금 처리할 일' })).toBeVisible()
  await expect(page.getByRole('region', { name: '서버 상태' })).toBeVisible()
  await card.click()
  await expect(page.getByRole('dialog', { name: '바로 처리' }).getByRole('region', { name: '처리', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('link', { name: /할 일/ }).click()
  await page.getByRole('button', { name: new RegExp(title) }).click()
  const decide = page.getByRole('region', { name: '처리', exact: true })
  await expect(decide).toContainText('야간')
  await decide.getByRole('button', { name: '처리하고 다음 건' }).click()
  await expect(page.getByRole('button', { name: new RegExp(title) })).toHaveCount(0)
  expect((await (await request.get('/api/activities')).json() as { id: number }[]).some(a => a.id === id)).toBeTruthy()

  await page.getByRole('link', { name: '현황' }).click()
  await expect(page.getByRole('region', { name: '서버 상태' })).toContainText('데이터베이스')
  await expect(page.getByRole('region', { name: '주별 신청' })).toBeVisible()
  await page.getByRole('textbox', { name: '회원 찾기' }).fill(email)
  await page.getByRole('textbox', { name: '회원 찾기' }).press('Enter')
  await page.getByRole('link', { name: 'PC 검토 모집자' }).click()
  await expect(page.getByRole('heading', { name: 'PC 검토 모집자' })).toBeVisible()
  await expect(page.getByText('모집한 활동')).toBeVisible()
  await page.getByRole('link', { name: '장소' }).click()
  await expect(page.getByRole('heading', { name: '장소' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: /좌표/ }).first()).toBeVisible()
})

test('login keeps working after a reload, and a 기관 page asks for login first', async ({ page, request }) => {
  await page.goto('/#/org')
  await expect(page.getByRole('heading', { name: '기관 로그인' })).toBeVisible()
  await page.goto('/#/org/records')
  await expect(page).toHaveURL(/#\/login\?next=/)
  await signIn(page, admin, env.DEMO_ACCOUNT_PASSWORD)
  await expect(page).toHaveURL(/#\/admin$/)
  await page.reload()
  await expect(page.getByRole('link', { name: '현황' })).toBeVisible()
  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/#\/$/)
})

test('기관 모집글: copy a post to two new dates at once, the 1365 link shows on its pages, and the attendance sheet downloads', async ({ page, request, browser }) => {
  const email = unique('pc-org-post')
  expect((await request.post('/api/auth/signup', { data: { memberType: 'INSTITUTION', name: '박담당', email, password, interests: [], organizationName: '복사 확인 센터', organizationContact: '031-222-3333', organizationType: 'NONPROFIT', agreedNotice: true } })).ok()).toBeTruthy()
  const adminAuth = await token(request, admin, env.DEMO_ACCOUNT_PASSWORD)
  const orgs = await (await request.get('/api/admin/organizations?status=PENDING', { headers: { Authorization: adminAuth } })).json() as { id: number; managerEmail: string }[]
  expect((await request.post(`/api/admin/organizations/${orgs.find(o => o.managerEmail === email)!.id}/approve`, { headers: { Authorization: adminAuth }, data: { reason: '확인 완료' } })).ok()).toBeTruthy()
  const auth = await token(request, email)
  const title = '기관 복사 확인 정리 ' + Math.floor(Math.random() * 1e5)
  const link = 'https://www.1365.go.kr/vols/P9210/partcptn/timeCptn.do?progrmRegistNo=42'
  const created = await request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'INSTITUTION', title, category: '지역사회', placeId: 1, date: inDays(5), time: '10:00', capacity: 5, durationMinutes: 120, description: body, safetyConfirmed: true, vmsLink: link } })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).id

  await signIn(page, email)
  await page.goto('/#/org/activity/' + id)
  await expect(page.getByRole('link', { name: '1365에도 등록' })).toHaveAttribute('href', link)
  await page.getByRole('tab', { name: '출석·완료' }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '출석부 내려받기' }).click()
  expect((await download).suggestedFilename()).toMatch(/^volink-attendance-\d{4}-\d{2}-\d{2}-\d+\.csv$/)
  await page.getByRole('button', { name: '일정 변경' }).click()
  await expect(page.getByRole('dialog', { name: '일정 변경' }).getByRole('button', { name: '일정 바꾸기' })).toBeDisabled()
  await page.keyboard.press('Escape')

  await page.getByRole('link', { name: '복사해서 새 모집' }).click()
  await expect(page.getByLabel('활동 이름')).toHaveValue(title)
  await expect(page.getByLabel('1365 모집 페이지 주소')).toHaveValue(link)
  for (const n of [9, 16]) {
    await page.getByRole('textbox', { name: '날짜 고르기' }).fill(inDays(n))
    await page.getByRole('button', { name: '날짜 추가' }).click()
  }
  await page.getByRole('checkbox', { name: /참여자에게 안내합니다/ }).check()
  await page.getByRole('button', { name: '2개 날짜로 올리기' }).click()
  await expect(page).toHaveURL(/#\/org\/activity\/\d+$/)
  const mine = await (await request.get('/api/me/activities', { headers: { Authorization: auth } })).json() as { title: string; date: string }[]
  expect(mine.filter(a => a.title === title).map(a => a.date).sort()).toEqual([inDays(5), inDays(9), inDays(16)])
  // The public page shows the 1365 link next to the app download.
  const visitor = await (await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })).newPage()
  await visitor.goto('/#/activity/' + id)
  await expect(visitor.getByRole('link', { name: '1365에서 보기' })).toHaveAttribute('href', link)
})

test('기관: a 19+ post with a question shows the answers to the institution, and its public page has the introduction and open posts', async ({ page, request, browser }) => {
  const email = unique('pc-org-page')
  const orgName = 'PC 공개 페이지 센터 ' + Math.floor(Math.random() * 1e5)
  expect((await request.post('/api/auth/signup', { data: { memberType: 'INSTITUTION', name: '최담당', email, password, interests: [], organizationName: orgName, organizationContact: '031-444-5555', organizationType: 'WELFARE', agreedNotice: true } })).ok()).toBeTruthy()
  const adminAuth = await token(request, admin, env.DEMO_ACCOUNT_PASSWORD)
  const orgs = await (await request.get('/api/admin/organizations?status=PENDING', { headers: { Authorization: adminAuth } })).json() as { id: number; managerEmail: string }[]
  const orgId = orgs.find(o => o.managerEmail === email)!.id
  expect((await request.post(`/api/admin/organizations/${orgId}/approve`, { headers: { Authorization: adminAuth }, data: { reason: '확인 완료' } })).ok()).toBeTruthy()
  const auth = await token(request, email)
  const title = '성인 질문 확인 정리 ' + Math.floor(Math.random() * 1e5)
  const created = await request.post('/api/activities', { headers: { Authorization: auth }, data: { activityType: 'INSTITUTION', title, category: '지역사회', placeId: 1, date: inDays(6), time: '10:00', capacity: 5, durationMinutes: 90, description: body, safetyConfirmed: true, youthOk: false, applyQuestion: '앞치마 사이즈를 알려 주세요' } })
  expect(created.ok()).toBeTruthy()
  const id = (await created.json()).id
  const member = await token(request, await person(request, 'PC 답변 회원'))
  expect((await request.post(`/api/activities/${id}/participations`, { headers: { Authorization: member }, data: { answer: 'L 사이즈요' } })).ok()).toBeTruthy()

  await signIn(page, email)
  await page.goto('/#/org/activity/' + id)
  await expect(page.getByRole('columnheader', { name: /앞치마 사이즈/ })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'L 사이즈요' })).toBeVisible()
  await page.goto('/#/org/profile')
  await page.getByLabel(/^소개/).fill('복지관 어르신 식사와 나들이를 함께해요.')
  await page.getByRole('button', { name: '소개 저장' }).click()
  await expect(page.getByRole('status')).toContainText('소개를 저장했어요')

  const visitor = await (await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })).newPage()
  await visitor.goto('/#/activity/' + id)
  await expect(visitor.getByText('만 19세 이상')).toBeVisible()
  await visitor.getByRole('link', { name: orgName }).click()
  await expect(visitor.getByRole('heading', { name: orgName })).toBeVisible()
  await expect(visitor.getByText('복지관 어르신 식사와 나들이를 함께해요.')).toBeVisible()
  await expect(visitor.getByRole('link', { name: title })).toBeVisible()
  await expect(visitor.locator('body')).not.toContainText('031-444-5555')
})
