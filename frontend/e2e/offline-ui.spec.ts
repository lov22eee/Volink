import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('published React artifact has six service screens without backend requests or internal project information', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', request => requests.push(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  const file = fileURLToPath(new URL('../../docs/ui/Volink_서비스화면.html', import.meta.url))
  const html = await readFile(file, 'utf8')
  expect(html).not.toMatch(/졸업작품|경동대학교|1주차|페르소나|report-20261006|addressNote|organizer-01|admin-01/)
  await page.setContent(html, { waitUntil: 'load' })
  await expect(page.locator('.activity-card')).toHaveCount(3)
  await expect(page.locator('body')).not.toContainText(/API|DB|WEEK|발표|개발 진행|사용자 흐름/)
  await page.screenshot({ path: '../docs/screenshots/offline-ui-home.png', fullPage: true })
  await page.getByRole('textbox', { name: '활동 또는 장소 검색' }).fill('플로깅')
  await expect(page.locator('.activity-card')).toHaveCount(1)
  await page.getByRole('link', { name: '우리 동네, 가벼운 플로깅 상세 보기' }).click()
  await expect(page.getByRole('heading', { name: '우리 동네, 가벼운 플로깅' })).toBeVisible()
  await expect(page.getByRole('button', { name: '참가 신청 · 준비 중' })).toBeDisabled()
  await page.getByRole('navigation', { name: '주요 메뉴' }).getByRole('link', { name: '활동 만들기', exact: true }).click()
  await expect(page.getByLabel('장소', { exact: true }).locator('option')).toHaveCount(4)
  await page.getByRole('link', { name: '내 활동', exact: true }).click()
  await expect(page.getByRole('tabpanel')).toBeVisible()
  await page.getByRole('navigation', { name: '계정 메뉴' }).getByRole('link', { name: '로그인', exact: true }).click()
  await expect(page.getByLabel('비밀번호', { exact: true })).toBeVisible()
  await page.getByRole('navigation', { name: '계정 메뉴' }).getByRole('link', { name: '회원가입', exact: true }).click()
  await page.getByRole('radio', { name: /기관회원/ }).check()
  await expect(page.getByLabel('기관명', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})
