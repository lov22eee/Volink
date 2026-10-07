import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontend = fileURLToPath(new URL('..', import.meta.url))
const index = await readFile(path.join(frontend, 'dist/index.html'), 'utf8')
const jsPath = index.match(/<script[^>]+src="([^"]+)"/)?.[1]
const cssPath = index.match(/<link[^>]+href="([^"]+\.css)"/)?.[1]
if (!jsPath || !cssPath) throw new Error('Build output script or stylesheet missing')
const js = await readFile(path.join(frontend, 'dist', jsPath), 'utf8')
const css = await readFile(path.join(frontend, 'dist', cssPath), 'utf8')
const catalog = JSON.parse(await readFile(path.join(frontend, 'fixtures/demo-catalog.json'), 'utf8'))
if (!catalog.demo || catalog.personas.some(persona => 'password' in persona)) throw new Error('Only public demo data may be exported')
// Publish only activity/venue examples; personas and internal development notes stay in the repository.
const publicCatalog = {
  demo: true,
  baseDate: catalog.baseDate,
  places: catalog.places.map(({ id, name, area }) => ({ id, name, area })),
  activities: catalog.activities,
}
const snapshot = JSON.stringify({ catalog: publicCatalog }).replace(/</g, '\\u003c')
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#245e48"><meta name="description" content="가까운 곳에서 함께하는 소규모 봉사활동. Volink에서 우리 동네의 작은 실천을 만나보세요.">
<title>Volink · 우리 동네의 작은 변화</title><style>${css}</style></head>
<body><div id="root"></div><script>window.__VOLINK_UI_DEMO__=${snapshot};</script>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script></body></html>`
const output = path.resolve(frontend, '../docs/ui')
await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'Volink_서비스화면.html'), html)
console.log('Exported the actual React UI to docs/ui/Volink_서비스화면.html; no server or external assets required.')
