import { describe, expect, it, vi } from 'vitest'
import { createLazyPageLoader } from '../lazyPage'

function TestPage() {
  return null
}

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  }
}

describe('createLazyPageLoader', () => {
  it('reloads once when a dynamic import chunk cannot be fetched', async () => {
    const storage = createStorage()
    const reload = vi.fn()
    const loader = createLazyPageLoader(
      async () => {
        throw new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/Viagens-old.js')
      },
      'Viagens',
      { pathname: '/viagens', reload, storage },
    )

    const promise = loader()

    await Promise.resolve()

    expect(storage.setItem).toHaveBeenCalledWith('chunk-reload:/viagens', '1')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(await Promise.race([promise.then(() => 'resolved'), Promise.resolve('pending')])).toBe('pending')
  })

  // VELA-1M: vite:preloadError com preventDefault() resolve o import() com
  // undefined; antes a tela quebrava com "reading 'Admin'".
  it('treats an import resolved as undefined as a chunk load failure', async () => {
    const storage = createStorage()
    const reload = vi.fn()
    const loader = createLazyPageLoader(
      async () => undefined as unknown as { Admin: typeof TestPage },
      'Admin',
      { pathname: '/admin', reload, storage },
    )

    const promise = loader()
    await Promise.resolve()
    await Promise.resolve()

    expect(storage.setItem).toHaveBeenCalledWith('chunk-reload:/admin', '1')
    expect(reload).toHaveBeenCalledTimes(1)
    expect(await Promise.race([promise.then(() => 'resolved'), Promise.resolve('pending')])).toBe('pending')
  })

  it('clears the route reload marker after a page module loads', async () => {
    const storage = createStorage({ 'chunk-reload:/viagens': '1' })
    const loader = createLazyPageLoader(async () => ({ Viagens: TestPage }), 'Viagens', {
      pathname: '/viagens',
      reload: vi.fn(),
      storage,
    })

    await expect(loader()).resolves.toEqual({ default: TestPage })

    expect(storage.removeItem).toHaveBeenCalledWith('chunk-reload:/viagens')
  })

  it('throws the dynamic import error after the same route already retried', async () => {
    const storage = createStorage({ 'chunk-reload:/viagens': '1' })
    const reload = vi.fn()
    const loader = createLazyPageLoader(
      async () => {
        throw new TypeError('Failed to fetch dynamically imported module: https://example.test/assets/Viagens-old.js')
      },
      'Viagens',
      { pathname: '/viagens', reload, storage },
    )

    await expect(loader()).rejects.toThrow('Failed to fetch dynamically imported module')
    expect(reload).not.toHaveBeenCalled()
  })

  it('throws non-chunk errors without reloading', async () => {
    const storage = createStorage()
    const reload = vi.fn()
    const loader = createLazyPageLoader(
      async () => {
        throw new Error('render setup failed')
      },
      'Viagens',
      { pathname: '/viagens', reload, storage },
    )

    await expect(loader()).rejects.toThrow('render setup failed')
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })
})
