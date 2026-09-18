import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

function resolveBuildId(): string {
  const commit =
    process.env.GITHUB_SHA?.slice(0, 7) ||
    process.env.HOSTINGER_GIT_COMMIT?.slice(0, 7) ||
    process.env.SOURCE_VERSION?.slice(0, 7)
  const now = new Date()
  const timestamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    '-',
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
  ].join('')
  return commit ? `${timestamp}-${commit}` : timestamp
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const buildId = env.VITE_BUILD_ID ? env.VITE_BUILD_ID : resolveBuildId()

  // En Hostinger / dominio raíz se usa '/' por defecto.
  // En GitHub Pages se sobreescribe con --base=/drhappy.github.io/
  return {
    base: './',
    define: {
      'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
    },
    plugins: [react()],
  }
})
