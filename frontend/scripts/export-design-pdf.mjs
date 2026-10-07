import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const repo = fileURLToPath(new URL('../..', import.meta.url))
const source = await readFile(path.join(repo, 'docs/design/week01.html'), 'utf8')
const output = path.join(repo, 'docs/design/Volink_1주차_설계요약.pdf')
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
})
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } })
  await page.route('**/*', route => route.abort())
  await page.setContent(source, { waitUntil: 'load' })
  await page.evaluate(() => {
    const roles = document.querySelector('#roles').cloneNode(true)
    const screens = document.querySelector('#screens').cloneNode(true)
    const plan = document.querySelector('#data .data-grid > div:last-child').cloneNode(true)
    plan.querySelector('h3').remove()
    const tests = document.createElement('section')
    tests.id = 'tests'
    tests.innerHTML = '<h2><span class="number">03</span>시연 자료와 기본 테스트 계획</h2>'
    tests.append(...plan.childNodes)
    roles.querySelector('.number').textContent = '01'
    screens.querySelector('.number').textContent = '02'
    const header = document.createElement('header')
    header.innerHTML = '<div class="brand">Volink</div><h1>1주차 설계 요약</h1>'
    document.querySelector('main').replaceChildren(header, roles, screens, tests)
    document.title = 'Volink · 1주차 설계 요약'
  })
  await page.addStyleTag({ content: [
    '@page { size: A4; margin: 12mm; }',
    ':root, html, body { background: white; } main { max-width: none; padding: 0; }',
    'header { margin-bottom: 14px; } header h1 { font-size: 25px; margin: 3px 0; }',
    'header p { font-size: 11px; margin: 5px 0 0; } .brand { font-size: 14px; }',
    'section { padding: 15px; margin: 12px 0; break-inside: avoid; }',
    'h2 { font-size: 17px; margin-bottom: 11px; } .number { font-size: 13px; }',
    '.table-wrap { overflow: visible; } table, td, th { font-size: 11px; } td, th { padding: 8px; }',
    '.wireframes { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }',
    '.wireframe { min-height: 0; break-inside: avoid; } .wireframe h3 { padding: 7px 9px; font-size: 11px; }',
    '.mock { padding: 9px; font-size: 9px; } .bar { padding: 4px 6px; margin-bottom: 5px; }',
    '.line { padding: 4px; } .map { min-height: 60px; } .action { padding: 4px; margin-top: 5px; }',
    '.tags { gap: 4px; } .tags span { padding: 2px 4px; } .two { gap: 5px; }',
    '.rules { grid-template-columns: repeat(3, 1fr); gap: 9px; font-size: 10px; margin-top: 12px; }',
    '.note, .tests { font-size: 11px; } .note { margin-top: 9px; }',
    '.tests { margin: 9px 0; } .tests li { margin: 3px 0; }',
    '#tests .tests { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }',
  ].join('\n') })
  await page.emulateMedia({ media: 'print' })
  await page.evaluate(() => document.fonts.ready)
  await page.pdf({ path: output, printBackground: true, preferCSSPageSize: true })
  console.log('Exported roles, six UI wireframes and demo/test plan to docs/design/Volink_1주차_설계요약.pdf')
} finally {
  await browser.close()
}
