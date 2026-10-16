import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

type LazyPageStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

type LazyPageOptions = {
  pathname?: string
  reload?: () => void
  storage?: LazyPageStorage
}

function getPathname(pathname?: string) {
  return pathname ?? globalThis.location?.pathname ?? '/'
}

function getStorage(storage?: LazyPageStorage) {
  try {
    return storage ?? globalThis.sessionStorage
  } catch {
    return null
  }
}

function markerKey(pathname?: string) {
  return `chunk-reload:${getPathname(pathname)}`
}

function isDynamicImportLoadError(error: unknown): error is TypeError {
  if (!(error instanceof TypeError)) return false

  const message = error.message.toLowerCase()
  return (
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('importing a module script failed')
  )
}

function chunkUrlOf(error: TypeError) {
  return /https?:\/\/\S+?\.js/.exec(error.message)?.[0] ?? null
}

// Um chunk salvo errado no cache HTTP (ex.: HTML do fallback como immutable)
// sobreviveria a um reload simples; rebuscar com cache 'reload' o sobrescreve.
function reloadBypassingChunkCache(error: TypeError) {
  const reload = () => globalThis.location?.reload()
  const url = chunkUrlOf(error)
  if (!url || !globalThis.fetch) return reload()
  void globalThis.fetch(url, { cache: 'reload' }).then(reload, reload)
}

export function createLazyPageLoader<T extends Record<string, unknown>, K extends keyof T & string>(
  loader: () => Promise<T>,
  exportName: K,
  options: LazyPageOptions = {},
) {
  return async () => {
    const storage = getStorage(options.storage)
    const key = markerKey(options.pathname)

    try {
      const module = await loader()
      // Um handler de vite:preloadError com preventDefault() faz o import()
      // resolver com undefined (cópia antiga de chunk-recovery.js em cache):
      // trata como chunk não carregado em vez de quebrar a tela (VELA-1M).
      if (module == null) throw new TypeError('Failed to fetch dynamically imported module: preload error handled without a module')
      storage?.removeItem(key)
      return { default: module[exportName] as ComponentType }
    } catch (error) {
      // O marcador guarda os chunks que já ganharam reload: a rota recarrega
      // uma vez por arquivo, não uma vez por sessão. No deploy, o chunk antigo
      // some e, logo após o reload, o novo ainda pode responder 404 por alguns
      // segundos; com um reload só por rota, a segunda falha virava tela de
      // erro (VELA-1P). Guardar todos (não só o último) impede laço quando
      // bordas da CDN alternam versões (A, B, A...). Sem URL na mensagem
      // (Safari), vale um reload por rota, como antes.
      if (isDynamicImportLoadError(error) && storage) {
        const attempt = chunkUrlOf(error) ?? '1'
        const attempted = (storage.getItem(key) ?? '').split('\n').filter(Boolean)
        if (!attempted.includes(attempt)) {
          storage.setItem(key, [...attempted, attempt].join('\n'))
          ;(options.reload ?? (() => reloadBypassingChunkCache(error)))()
          return new Promise<never>(() => {})
        }
      }

      throw error
    }
  }
}

export function lazyPage<T extends Record<string, unknown>, K extends keyof T & string>(
  loader: () => Promise<T>,
  exportName: K,
) {
  let promise: Promise<{ default: ComponentType }> | undefined
  const load = () => {
    promise ??= createLazyPageLoader(loader, exportName)()
    return promise.catch((error) => {
      promise = undefined
      throw error
    })
  }
  const component = lazy(load) as LazyExoticComponent<ComponentType> & { preload: () => Promise<unknown> }
  component.preload = load
  return component
}
