import { execFileSync, spawnSync, type ExecFileSyncOptions, type SpawnSyncReturns } from 'node:child_process'
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads'
import { afterAll } from 'vitest'

/**
 * `psql` das suítes `local-pg` com uma conexão reaproveitada (Lote 2 do plano
 * docs/plans/2026-10-15-compactacao-do-ci.md). Cada chamada abria um processo
 * `psql` e uma conexão nova: 4.042 por passada, ~45 ms cada.
 *
 * `execPsql` e `spawnPsql` recebem os mesmos argumentos e opções que
 * `execFileSync('psql', ...)` e `spawnSync('psql', ...)` e devolvem o mesmo
 * formato, para a troca nas suítes ser mecânica. Contrato preservado:
 * - sessão limpa depois de cada chamada (`ROLLBACK` se preciso e `DISCARD ALL`);
 * - saída do `-At`: valores como texto do servidor, `|` entre colunas, uma linha
 *   por registro, todos os resultados de um `-c` com vários comandos (psql 15+)
 *   e a etiqueta do comando sem `-q`;
 * - erro e avisos no stderr no formato do libpq (com `VERBOSITY=verbose`,
 *   SQLSTATE e LOCATION); `-c` é uma transação implícita, e `-f`/stdin roda
 *   comando a comando, parando no erro com `ON_ERROR_STOP=1`;
 * - status 1 para erro em `-c`, 3 para erro em script com `ON_ERROR_STOP`.
 *
 * ponytail: variável personalizada (`request.jwt.claim.sub`, `vela.*`) que a
 * sessão já usou continua existindo depois do `DISCARD ALL`, com valor `''`:
 * `current_setting(nome, true)` devolve `''`, não `NULL` como num `psql` novo.
 * É o comportamento de uma conexão reaproveitada, como a do PostgREST. Teste
 * que precise do `NULL` de sessão nova usa `spawnSync('psql')` com exceção em
 * scripts/check-local-pg-ci.mjs.
 *
 * O teste vê uma chamada síncrona: um worker guarda a conexão e a thread do
 * teste espera a resposta com `Atomics.wait`. Argumento ou opção que o helper
 * não imita (formato alinhado, `env` próprio) cai no binário `psql`.
 * Teste que precisa de outra sessão em paralelo continua usando `spawn('psql')`.
 */

type Command = { kind: 'c'; text: string } | { kind: 'f'; path: string; prefixed: true } | { kind: 'stdin'; text: string; prefixed: boolean }
type Request = { url: string; commands: Command[]; quiet: boolean; verbose: boolean; onErrorStop: boolean }
type Response = { status: number; stdout: string; stderr: string }
type PsqlOptions = Pick<ExecFileSyncOptions, 'input' | 'stdio' | 'env' | 'maxBuffer'> & { encoding?: BufferEncoding | 'buffer' | null }

let bridge: { worker: Worker; port: MessagePort; flag: Int32Array } | null = null

function getBridge() {
  if (bridge) return bridge
  const shared = new SharedArrayBuffer(4)
  const { port1, port2 } = new MessageChannel()
  const worker = new Worker(new URL('./localPsqlWorker.mjs', import.meta.url), {
    workerData: { port: port2, shared },
    transferList: [port2],
  })
  worker.unref()
  port1.unref()
  bridge = { worker, port: port1, flag: new Int32Array(shared) }
  return bridge
}

function call(message: Request | { close: true }): Response {
  const { port, flag } = getBridge()
  Atomics.store(flag, 0, 0)
  port.postMessage(message)
  // Mesmo teto de um teste travado: 10 min sem resposta é falha do helper.
  if (Atomics.wait(flag, 0, 0, 600_000) === 'timed-out') throw new Error('localPsql: o worker não respondeu em 10 min')
  const reply = receiveMessageOnPort(port)
  if (!reply) throw new Error('localPsql: resposta ausente do worker')
  return reply.message as Response
}

/** Converte argv do psql num pedido; `null` quando o helper não imita algum argumento. */
export function parsePsqlArgs(args: readonly string[], input: unknown): Request | null {
  let url = ''
  let aligned = true
  let tuplesOnly = false
  let quiet = false
  let verbose = false
  let onErrorStop = false
  const commands: Command[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '-d') url = args[++index]
    else if (arg === '-c') commands.push({ kind: 'c', text: args[++index] })
    else if (arg === '-f') {
      const path = args[++index]
      if (path === '-') commands.push({ kind: 'stdin', text: String(input ?? ''), prefixed: true })
      else commands.push({ kind: 'f', path, prefixed: true })
    } else if (arg === '-v') {
      const [name, value] = args[++index].split('=')
      if (name === 'ON_ERROR_STOP') onErrorStop = value === '1'
      else if (name === 'VERBOSITY') {
        if (value !== 'verbose' && value !== 'default') return null
        verbose = value === 'verbose'
      } else return null
    } else if (/^-[XAtq]+$/.test(arg)) {
      if (arg.includes('A')) aligned = false
      if (arg.includes('t')) tuplesOnly = true
      if (arg.includes('q')) quiet = true
    } else return null
  }
  if (!commands.length) commands.push({ kind: 'stdin', text: String(input ?? ''), prefixed: false })
  if (!url || aligned || !tuplesOnly) return null
  return { url, commands, quiet, verbose, onErrorStop }
}

function convert(text: string, encoding: PsqlOptions['encoding']): string | Buffer {
  return encoding && encoding !== 'buffer' ? text : Buffer.from(text)
}

function runPsql(args: readonly string[], options: PsqlOptions): Response | null {
  if (options.env) return null
  const request = parsePsqlArgs(args, options.input)
  return request && call(request)
}

/** Igual a `execFileSync('psql', args, options)`. */
export function execPsql(args: readonly string[], options: PsqlOptions & { encoding: BufferEncoding }): string
export function execPsql(args: readonly string[], options?: PsqlOptions): string | Buffer
export function execPsql(args: readonly string[], options: PsqlOptions = {}): string | Buffer {
  const response = runPsql(args, options)
  if (!response) return execFileSync('psql', args, options as ExecFileSyncOptions)
  if (response.status !== 0) {
    const error = new Error(`Command failed: psql ${args.join(' ')}\n${response.stderr}`) as Error & Partial<SpawnSyncReturns<string | Buffer>>
    error.status = response.status
    error.stdout = convert(response.stdout, options.encoding)
    error.stderr = convert(response.stderr, options.encoding)
    error.output = [null, error.stdout, error.stderr]
    throw error
  }
  return convert(response.stdout, options.encoding)
}

/** Igual a `spawnSync('psql', args, options)`. */
export function spawnPsql(args: readonly string[], options: PsqlOptions & { encoding: BufferEncoding }): SpawnSyncReturns<string>
export function spawnPsql(args: readonly string[], options?: PsqlOptions): SpawnSyncReturns<string | Buffer>
export function spawnPsql(args: readonly string[], options: PsqlOptions = {}): SpawnSyncReturns<string | Buffer> {
  const response = runPsql(args, options)
  if (!response) return spawnSync('psql', args, options as Parameters<typeof spawnSync>[2]) as SpawnSyncReturns<string | Buffer>
  const stdout = convert(response.stdout, options.encoding)
  const stderr = convert(response.stderr, options.encoding)
  return { pid: 0, status: response.status, signal: null, stdout, stderr, output: [null, stdout, stderr] }
}

/** Fecha as conexões do worker (o processo do Vitest também as fecha ao sair). */
export function closeLocalPsql(): void {
  if (!bridge) return
  call({ close: true })
  void bridge.worker.terminate()
  bridge = null
}

// Uma conexão por arquivo de suíte: fecha ao fim do arquivo que importou o helper.
afterAll(() => closeLocalPsql())
