import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

function resolveBuildId(): string {
  const counterPath = path.join(process.cwd(), '.build-counter')
  const currentValue = fs.existsSync(counterPath)
    ? Number.parseInt(fs.readFileSync(counterPath, 'utf8').trim(), 10)
    : 0

  const safeValue = Number.isFinite(currentValue) ? currentValue : 0
  const buildId = safeValue.toString().padStart(5, '0')

  fs.writeFileSync(counterPath, String(safeValue + 1), 'utf8')
  return buildId
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const buildId = env.VITE_BUILD_ID ? env.VITE_BUILD_ID : resolveBuildId()

  return {
    base: '/drhappy.github.io/',
    define: {
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
    },
    plugins: [react()],
    preview: {
      // Permite acceder desde túneles temporales de demostración (trycloudflare.com)
      allowedHosts: ['.trycloudflare.com'],
    },
  }
})
