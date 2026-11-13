import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 실적확인서 reader (2026-11-12): the OCR worker and engine files ship with the site and the app under /ocr/ (the Korean
 * model is in public/ocr), so reading a photo does not depend on a CDN download on the phone.
 */
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': 'tesseract.js/dist/worker.min.js',
  'ocr/tesseract-core-simd-lstm.wasm.js': 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/tesseract-core-lstm.wasm.js': 'tesseract.js-core/tesseract-core-lstm.wasm.js',
}
const nodeModule = (path: string) => fileURLToPath(new URL('./node_modules/' + path, import.meta.url))
function ocrFiles(): Plugin {
  return {
    name: 'volink-ocr-files',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\//, '')
        const from = OCR_FILES[path]
        if (!from) return next()
        res.setHeader('Content-Type', 'text/javascript')
        res.end(readFileSync(nodeModule(from)))
      })
    },
    generateBundle() {
      for (const [fileName, from] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(nodeModule(from)) })
    },
  }
}

export default defineConfig({
  plugins: [react(), ocrFiles()],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8080',
      '/actuator': 'http://127.0.0.1:8080',
    },
  },
})
