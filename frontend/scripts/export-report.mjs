import { chromium } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontend = fileURLToPath(new URL('..', import.meta.url))
const repo = path.resolve(frontend, '..')
const source = path.join(repo, 'docs/archive/report-20261006.html')
const output = path.join(repo, 'docs/slides')
const captures = path.join(repo, 'docs/screenshots')
await mkdir(output, { recursive: true })
await mkdir(captures, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  // Render our self-contained HTML directly; managed cloud browsers restrict file:// navigation.
  await page.setContent(await readFile(source, 'utf8'), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: path.join(captures, 'submitted-report-cover.png'), fullPage: true })
  await page.getByRole('button', { name: '3번 슬라이드', exact: true }).click()
  await page.screenshot({ path: path.join(captures, 'submitted-report-roles.png'), fullPage: true })
  await page.getByRole('button', { name: '4번 슬라이드', exact: true }).click()
  await page.screenshot({ path: path.join(captures, 'submitted-report-ui.png'), fullPage: true })
  await page.getByRole('button', { name: '활동 찾기', exact: false }).click()
  await page.pdf({
    path: path.join(output, 'Volink_제출보고서_발표_20261006.pdf'),
    width: '1280px', height: '720px', printBackground: true,
    preferCSSPageSize: true,
  })
  console.log('Exported 7 report-based slides to PDF and 3 actual presentation screenshots.')
} finally {
  await browser.close()
}
