import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { taskBackupEnvironment } from './backup-r2.mjs'

const projectRef = 'fgmkhbzhaeebrsizwccx'
const backupScript = fileURLToPath(new URL('./backup-r2.mjs', import.meta.url))
const secretEnvironmentNames = [
  'BACKUP_TASK_DATABASE_URL',
  'BACKUP_TASK_ENCRYPTION_KEY_HEX',
  'BACKUP_TASK_R2_ACCESS_KEY_ID',
  'BACKUP_TASK_R2_SECRET_ACCESS_KEY',
]

function buildBackupTaskCommand(scriptPath, targetProjectRef) {
  if (!path.isAbsolute(scriptPath) && !path.win32.isAbsolute(scriptPath)) {
    throw new Error('caminho absoluto do script de backup obrigatorio.')
  }
  if (!/^[a-z0-9]{20}$/.test(targetProjectRef ?? '')) {
    throw new Error('projectRef Supabase invalido.')
  }

  return [scriptPath, '--execute', '--allow-production', '--environment', 'production', '--project-ref', targetProjectRef]
}

function runBackupTask({ source = process.env, invoke = spawnSync, runtime = process.execPath } = {}) {
  try {
    const environment = taskBackupEnvironment({
      databaseUrl: source.BACKUP_TASK_DATABASE_URL,
      encryptionKeyHex: source.BACKUP_TASK_ENCRYPTION_KEY_HEX,
      r2AccessKeyId: source.BACKUP_TASK_R2_ACCESS_KEY_ID,
      r2SecretAccessKey: source.BACKUP_TASK_R2_SECRET_ACCESS_KEY,
    }, {
      endpoint: source.BACKUP_TASK_R2_ENDPOINT,
      bucket: source.BACKUP_TASK_R2_BUCKET,
      projectRef,
    }, source)

    const result = invoke(runtime, buildBackupTaskCommand(backupScript, projectRef), {
      cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      env: environment,
      stdio: 'inherit',
      windowsHide: true,
    })
    if (result.error) throw new Error('Nao foi possivel iniciar o processo de backup R2.')
    return result.status ?? 1
  } finally {
    if (source === process.env) {
      for (const name of secretEnvironmentNames) delete process.env[name]
    }
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (import.meta.url === invokedPath) {
  try {
    process.exitCode = runBackupTask()
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}

export { buildBackupTaskCommand, runBackupTask }
