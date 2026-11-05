import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

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
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '모집' }).click()
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
