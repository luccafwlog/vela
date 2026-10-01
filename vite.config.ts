import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const appCommitSha = resolveCommitSha()

function resolveCommitSha() {
  if (process.env.VITE_APP_COMMIT_SHA) return process.env.VITE_APP_COMMIT_SHA.slice(0, 12)
  try {
    return execSync('git rev-parse --short=12 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'unknown'
  }
}

function originOf(value: string | undefined) {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Upload de sourcemaps para o Sentry: transforma `at Ki (featureFlags-*.js:7:7109)`
  // em nome de função/arquivo/linha reais nas issues. Só ativa no CI, onde
  // SENTRY_AUTH_TOKEN está presente; builds locais seguem sem o plugin.
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(sentryAuthToken
        ? [
            sentryVitePlugin({
              org: 'fwlog',
              project: ['vela', 'portal'],
              authToken: sentryAuthToken,
              release: { name: appCommitSha },
              sourcemaps: {
                assets: ['dist/**/*.js', 'dist/**/*.mjs'],
                filesToDeleteAfterUpload: ['dist/**/*.map'],
              },
              telemetry: false,
            }),
          ]
        : []),
      {
        name: 'inject-external-preconnects',
        configureServer(server) {
          server.middlewares.use((request, _response, next) => {
            const requestUrl = request.url
            if (!requestUrl) {
              next()
              return
            }

            const queryStart = requestUrl.indexOf('?')
            const pathname = queryStart >= 0 ? requestUrl.slice(0, queryStart) : requestUrl
            if (pathname === '/portal' || pathname.startsWith('/portal/')) {
              const query = queryStart >= 0 ? requestUrl.slice(queryStart) : ''
              // Vite's dev fallback otherwise serves index.html for this MPA
              // route. The browser keeps /portal/* in its address bar while
              // the server transforms the Portal entry HTML.
              request.url = `/portal.html${query}`
            }
            next()
          })
        },
        transformIndexHtml(html: string) {
          const origins = [originOf(env.VITE_SUPABASE_URL), originOf('https://olinda.bcb.gov.br')].filter(
            (origin): origin is string => Boolean(origin),
          )
          const links = [...new Set(origins)]
            .map((origin) => `<link rel="preconnect" href="${origin}" crossorigin>`)
            .join('\n    ')
          return html.replace('<head>', `<head>\n    ${links}`)
        },
      },
    ],
    server: {
      proxy: {
        // Proxy dev-only usado pela skill design-audit: aponte VITE_SUPABASE_URL
        // para http://127.0.0.1:5173/sb-proxy e rode scripts/design-audit/sb-shim.cjs.
        // Sem efeito quando o .env aponta direto para o Supabase real.
        '/sb-proxy': {
          target: 'http://127.0.0.1:54321',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/sb-proxy/, ''),
        },
      },
    },
    define: {
      'process.env': {},
      'import.meta.env.VITE_APP_COMMIT_SHA': JSON.stringify(appCommitSha),
    },
    build: {
      manifest: true,
      sourcemap: 'hidden',
      rollupOptions: {
        input: {
          internal: resolve(process.cwd(), 'index.html'),
          portal: resolve(process.cwd(), 'portal.html'),
        },
        output: {
          // Isola vendors estáveis em chunks próprios para melhorar o cache do
          // browser entre deploys (mudam com pouca frequência). xlsx já é
          // code-split via import dinâmico, então fica de fora daqui.
          manualChunks: (id: string) => {
            if (
              id.includes('node_modules/react-router') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/react/')
            ) {
              return 'vendor-react'
            }
            if (id.includes('node_modules/@tanstack') || id.includes('node_modules/@supabase')) {
              return 'vendor-data'
            }
          },
        },
      },
    },
    test: {
      // Padrão node (rápido) para os testes de serviço/lib. Testes de componente
      // (.test.tsx) optam por jsdom via comentário `// @vitest-environment jsdom`.
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
