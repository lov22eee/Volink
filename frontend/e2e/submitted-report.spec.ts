import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../../docs/archive/report-20261006.html', import.meta.url))

test('submitted report deck works offline with keyboard, notes and all seven slides', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', r => { if (/^https?:/.test(r.url())) externalRequests.push(r.url()) })
  await page.route('**/*', route => route.abort())
  await page.setContent(await readFile(source, 'utf8'), { waitUntil: 'load' })
  await expect(page.locator('.slide:not([hidden])')).toHaveCount(1)
  await expect(page.locator('.counter')).toHaveText('1 / 7')
  await expect(page.getByRole('button', { name: '이전', exact: false })).toBeDisabled()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.counter')).toHaveText('2 / 7')
  await page.getByRole('button', { name: '3번 슬라이드' }).click()
  await expect(page.getByRole('heading', { name: '기관회원', exact: true })).toBeVisible()
  await expect(page.getByText('설계 포함 · 현재 코드 미구현')).toBeVisible()
  await page.keyboard.press('s')
  await expect(page.locator('#speaker')).toBeVisible()
  await expect(page.locator('#notes')).toContainText('현재 코드에 아직 적용하지 않았습니다.')
  await page.keyboard.press('End')
  await expect(page.locator('.counter')).toHaveText('7 / 7')
  await expect(page.getByRole('button', { name: '다음', exact: false })).toBeDisabled()
  await expect(page.getByRole('heading', { name: '회원 역할별 화면' })).toBeVisible()
  await page.keyboard.press('Home')
  await expect(page.locator('.counter')).toHaveText('1 / 7')
  await page.emulateMedia({ media: 'print' })
  for (const slide of await page.locator('.slide').all()) await expect(slide).toBeVisible()
  expect(externalRequests).toEqual([])
})

test('UI wireframes switch all six screens and presentation works on mobile', async ({ page }) => {
  await page.setContent(await readFile(source, 'utf8'), { waitUntil: 'load' })
  await page.getByRole('button', { name: '4번 슬라이드' }).click()
  const names = ['활동 찾기', '활동 상세', '활동 만들기', '내 활동', '로그인', '회원가입']
  for (const name of names) {
    await page.getByRole('button', { name, exact: false }).click()
    await expect(page.locator('.mock-screen:not([hidden])')).toHaveCount(1)
  }
  await expect(page.getByRole('heading', { name: '일반회원 · 기관회원 가입' })).toBeVisible()
  await expect(page.getByText('기관 승인 대기', { exact: true })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: '1번 슬라이드' }).click()
  await expect(page.locator('.cover-title')).toBeVisible()
})
