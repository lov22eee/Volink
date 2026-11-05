// Draws the Android app icon and launch screen (green leaf on white, the app's own leaf mark) into android/app/src/main/res.
// Run from frontend/: node scripts/make-app-icons.mjs  (uses the installed Playwright Chromium; no network)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

const RES = 'android/app/src/main/res'
const GREEN = '#2f6f52', MINT = '#e7f1ea'
// The leaf of the app's icon set (24-unit box, roughly 5..19 on both axes), filled, with a white vein.
const leaf = (cx, cy, size) => {
  const s = size / 14
  return `<g transform="translate(${cx - 12 * s} ${cy - 12 * s}) scale(${s})">
    <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14Z" fill="${GREEN}" stroke="${GREEN}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="m6.2 17.8 7.3-7.3" stroke="#fff" stroke-width="1.5" stroke-linecap="round" fill="none"/></g>`
}
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
const files = []
for (const [name, k] of Object.entries(densities)) {
  const fg = 108 * k, icon = 48 * k
  // Adaptive icon foreground (108dp; only the middle 66dp is always visible). Background is white (values/ic_launcher_background.xml).
  files.push([`mipmap-${name}/ic_launcher_foreground.png`, fg, fg, svg(fg, fg, leaf(fg / 2, fg / 2, fg * 0.36)), true])
  // Older Android: a white rounded square / circle with a soft mint ring.
  files.push([`mipmap-${name}/ic_launcher.png`, icon, icon, svg(icon, icon,
    `<rect x="${icon * 0.04}" y="${icon * 0.04}" width="${icon * 0.92}" height="${icon * 0.92}" rx="${icon * 0.22}" fill="#fff" stroke="${MINT}" stroke-width="${icon * 0.03}"/>${leaf(icon / 2, icon / 2, icon * 0.5)}`), true])
  files.push([`mipmap-${name}/ic_launcher_round.png`, icon, icon, svg(icon, icon,
    `<circle cx="${icon / 2}" cy="${icon / 2}" r="${icon * 0.46}" fill="#fff" stroke="${MINT}" stroke-width="${icon * 0.03}"/>${leaf(icon / 2, icon / 2, icon * 0.5)}`), true])
}
// Launch screen before Android 12 (12+ shows the icon on white by itself).
const splash = { 'drawable': [480, 320], 'drawable-land-mdpi': [480, 320], 'drawable-land-hdpi': [800, 480], 'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960], 'drawable-land-xxxhdpi': [1920, 1280], 'drawable-port-mdpi': [320, 480], 'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280], 'drawable-port-xxhdpi': [960, 1600], 'drawable-port-xxxhdpi': [1280, 1920] }
for (const [dir, [w, h]] of Object.entries(splash)) {
  const m = Math.min(w, h), size = m * 0.2
  files.push([`${dir}/splash.png`, w, h, svg(w, h, `<rect width="${w}" height="${h}" fill="#fff"/>${leaf(w / 2, h / 2 - size * 0.35, size)}
    <text x="${w / 2}" y="${h / 2 + size * 0.95}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size * 0.42}" letter-spacing="${-size * 0.015}" fill="${GREEN}">Volink</text>`), false])
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined })
const page = await browser.newPage({ deviceScaleFactor: 1 })
for (const [file, w, h, markup, transparent] of files) {
  await page.setViewportSize({ width: Math.round(w), height: Math.round(h) })
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup}</body></html>`)
  const out = join(RES, file)
  mkdirSync(dirname(out), { recursive: true })
  await page.locator('svg').screenshot({ path: out, omitBackground: transparent })
}
await browser.close()
console.log(`${files.length} images written to ${RES}`)
