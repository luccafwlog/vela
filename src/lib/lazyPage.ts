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

// Um chunk salvo errado no cache HTTP (ex.: HTML do fallback como immutable)
// sobreviveria a um reload simples; rebuscar com cache 'reload' o sobrescreve.
function reloadBypassingChunkCache(error: TypeError) {
  const reload = () => globalThis.location?.reload()
  const url = /https?:\/\/\S+?\.js/.exec(error.message)?.[0]
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
      if (isDynamicImportLoadError(error) && storage && storage.getItem(key) !== '1') {
        storage.setItem(key, '1')
        ;(options.reload ?? (() => reloadBypassingChunkCache(error)))()
        return new Promise<never>(() => {})
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
