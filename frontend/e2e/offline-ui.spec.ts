import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

test('exported actual React UI works without any server and identifies stored example data', async ({ page }) => {
  const requests: string[] = []
  const errors: string[] = []
  page.on('request', request => requests.push(request.url()))
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => route.abort())
  const file = fileURLToPath(new URL('../../docs/ui/Volink_서비스화면.html', import.meta.url))
  await page.setContent(await readFile(file, 'utf8'), { waitUntil: 'load' })
  await expect(page.getByRole('status')).toHaveText('화면 시안 · 오프라인')
  await expect(page.locator('.activity-card')).toHaveCount(3)
  await expect(page.getByText('API · DB 연결됨', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: '../docs/screenshots/offline-ui-home.png', fullPage: true })
  await page.getByRole('textbox', { name: '활동 또는 장소 검색' }).fill('플로깅')
  await expect(page.locator('.activity-card')).toHaveCount(1)
  await page.getByRole('button', { name: '우리 동네, 가벼운 플로깅 상세 보기' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '활동 만들기', exact: true }).click()
  await expect(page.getByRole('heading', { name: '작은 실천을 시작해요' })).toBeVisible()
  await expect(page.getByLabel('장소 후보').locator('option')).toHaveCount(4)
  await page.getByRole('link', { name: '사용자 흐름', exact: true }).click()
  await page.getByRole('button', { name: '관리자', exact: true }).click()
  await expect(page.getByRole('heading', { name: '관리자의 서비스 이용 흐름' })).toBeVisible()
  await page.getByRole('link', { name: '개발 진행 현황', exact: true }).click()
  await expect(page.locator('.persona')).toHaveCount(9)
  await expect(page.getByRole('heading', { name: '파일에 포함된 시연 구성' })).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})
