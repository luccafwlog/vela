[CmdletBinding()]
param(
  [switch]$StoreCredentials,
  [switch]$InstallTask,
  [switch]$Run,
  [switch]$SelfTest
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$selectedModes = @()
if ($StoreCredentials) { $selectedModes += 'StoreCredentials' }
if ($InstallTask) { $selectedModes += 'InstallTask' }
if ($Run) { $selectedModes += 'Run' }
if ($SelfTest) { $selectedModes += 'SelfTest' }
if ($selectedModes.Count -ne 1) {
  throw 'Choose exactly one mode: -StoreCredentials, -InstallTask, -Run or -SelfTest.'
}

$credentialTypeName = 'VelaBackupCredentialStore'
if (-not ($credentialTypeName -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;

public static class VelaBackupCredentialStore
{
    private const uint GenericCredential = 1;
    private const uint PersistLocalMachine = 2;
    private const int NotFound = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string UserName;
    }

    [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref Credential credential, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("Advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree")]
    private static extern void CredFree(IntPtr credential);

    public static bool Exists(string target)
    {
        IntPtr pointer;
        if (CredRead(target, GenericCredential, 0, out pointer))
        {
            CredFree(pointer);
            return true;
        }
        int error = Marshal.GetLastWin32Error();
        if (error == NotFound) return false;
        throw new Win32Exception(error);
    }

    public static void Write(string target, SecureString value)
    {
        IntPtr securePointer = IntPtr.Zero;
        IntPtr blobPointer = IntPtr.Zero;
        byte[] bytes = null;
        try
        {
            securePointer = Marshal.SecureStringToGlobalAllocUnicode(value);
            bytes = new byte[checked(value.Length * 2)];
            Marshal.Copy(securePointer, bytes, 0, bytes.Length);
            blobPointer = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, blobPointer, bytes.Length);
            Credential credential = new Credential
            {
                Type = GenericCredential,
                TargetName = target,
                CredentialBlobSize = (uint)bytes.Length,
                CredentialBlob = blobPointer,
                Persist = PersistLocalMachine,
                UserName = "Vela backup"
            };
            if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            if (bytes != null) Array.Clear(bytes, 0, bytes.Length);
            if (blobPointer != IntPtr.Zero)
            {
                if (bytes != null)
                {
                    for (int index = 0; index < bytes.Length; index++) Marshal.WriteByte(blobPointer, index, 0);
                }
                Marshal.FreeHGlobal(blobPointer);
            }
            if (securePointer != IntPtr.Zero) Marshal.ZeroFreeGlobalAllocUnicode(securePointer);
        }
    }

    public static string Read(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, GenericCredential, 0, out pointer))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == NotFound) return null;
            throw new Win32Exception(error);
        }

        byte[] bytes = null;
        try
        {
            Credential credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
            if (credential.CredentialBlobSize == 0 || credential.CredentialBlobSize % 2 != 0) return null;
            bytes = new byte[credential.CredentialBlobSize];
            Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length);
            return Encoding.Unicode.GetString(bytes);
        }
        finally
        {
            if (bytes != null) Array.Clear(bytes, 0, bytes.Length);
            CredFree(pointer);
        }
    }

    public static void Delete(string target)
    {
        if (!CredDelete(target, GenericCredential, 0))
        {
            int error = Marshal.GetLastWin32Error();
            if (error != NotFound) throw new Win32Exception(error);
        }
    }
}
'@
}

$credentialTargets = [ordered]@{
  databaseUrl = 'VelaBackup/SupabaseDbUrl'
  encryptionKeyHex = 'VelaBackup/EncryptionKeyHex'
  r2AccessKeyId = 'VelaBackup/R2AccessKeyId'
  r2SecretAccessKey = 'VelaBackup/R2SecretAccessKey'
}

function Test-CredentialStoreRoundTrip {
  $target = "VelaBackup/Test/$([Guid]::NewGuid().ToString('N'))"
  $expected = 'synthetic-test-only'
  $secureValue = New-Object System.Security.SecureString
  foreach ($character in $expected.ToCharArray()) { $secureValue.AppendChar($character) }
  $secureValue.MakeReadOnly()
  try {
    [VelaBackupCredentialStore]::Write($target, $secureValue)
    $actual = [VelaBackupCredentialStore]::Read($target)
    if ($actual -cne $expected) { throw 'Synthetic credential read did not match.' }
  }
  finally {
    $secureValue.Dispose()
    [VelaBackupCredentialStore]::Delete($target)
  }
  if ([VelaBackupCredentialStore]::Exists($target)) { throw 'Temporary credential was not removed.' }
  Write-Output 'OK CredMan synthetic credential round-trip; temporary target removed.'
}

function Save-BackupCredentials {
  $prompts = @{
    databaseUrl = 'URL PostgreSQL Supabase com SSL'
    encryptionKeyHex = 'chave AES hexadecimal com 64 caracteres'
    r2AccessKeyId = 'Access Key ID do token R2 restrito ao bucket'
    r2SecretAccessKey = 'Secret Access Key do token R2'
  }

  foreach ($entry in $credentialTargets.GetEnumerator()) {
    if ([VelaBackupCredentialStore]::Exists($entry.Value)) {
      $replace = Read-Host "Credential '$($entry.Value)' already exists. Replace it? Type Y to confirm"
      if ($replace -notin @('Y', 'y', 'YES', 'yes')) {
        Write-Output "Mantida: $($entry.Value)"
        continue
      }
    }

    $secureValue = Read-Host "Informe $($prompts[$entry.Key]) (entrada oculta)" -AsSecureString
    try {
      if ($secureValue.Length -eq 0) { throw "Empty value for $($entry.Value)." }
      [VelaBackupCredentialStore]::Write($entry.Value, $secureValue)
      Write-Output "Armazenada no Gerenciador de Credenciais: $($entry.Value)"
    }
    finally {
      $secureValue.Dispose()
    }
  }
}

function Install-BackupTask {
  $repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
  $packagePath = Join-Path $repositoryRoot 'package.json'
  $runnerPath = Join-Path $PSScriptRoot 'backup-r2-task.mjs'
  if (-not (Test-Path $packagePath) -or -not (Test-Path $runnerPath)) {
    throw 'The checkout does not contain the expected backup runner.'
  }

  $branch = (& git -C $repositoryRoot branch --show-current 2>$null | Select-Object -First 1)
  if ($LASTEXITCODE -ne 0 -or $branch.Trim() -ne 'main') {
    throw 'Install this task only from main after the implementation has been merged.'
  }
  $dirty = & git -C $repositoryRoot status --porcelain -- scripts/backup-r2.mjs scripts/backup-r2-task.mjs scripts/backup-r2-task.ps1 scripts/backup-r2.test.mjs package.json
  if ($LASTEXITCODE -ne 0 -or $dirty) {
    throw 'Backup runner files have local changes; update main before installing the task.'
  }

  foreach ($target in $credentialTargets.Values) {
    if (-not [VelaBackupCredentialStore]::Exists($target)) { throw "Missing credential: $target." }
  }
  $taskName = 'Vela-R2-Database-Backup-Daily'
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    throw "Task '$taskName' already exists; it will not be replaced automatically."
  }

  $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments = "-NoProfile -File `"$PSCommandPath`" -Run"
  $action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $repositoryRoot
  $trigger = New-ScheduledTaskTrigger -Daily -At '09:00'
  $settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 30) `
    -ExecutionTimeLimit (New-TimeSpan -Hours 6) `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Limited

  Register-ScheduledTask `
    -TaskName $taskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Runs an encrypted daily Supabase backup to the private R2 bucket; catches up a missed run after Windows sign-in.' | Out-Null
  Write-Output "Task '$taskName' installed for 09:00 local time with StartWhenAvailable and network required. It runs after user sign-in."
}

function Invoke-BackupTask {
  $environmentNames = @(
    'BACKUP_TASK_DATABASE_URL',
    'BACKUP_TASK_ENCRYPTION_KEY_HEX',
    'BACKUP_TASK_R2_ACCESS_KEY_ID',
    'BACKUP_TASK_R2_SECRET_ACCESS_KEY',
    'BACKUP_TASK_R2_ENDPOINT',
    'BACKUP_TASK_R2_BUCKET'
  )
  try {
    foreach ($entry in $credentialTargets.GetEnumerator()) {
      $value = [VelaBackupCredentialStore]::Read($entry.Value)
      if ([string]::IsNullOrWhiteSpace($value)) { throw "Missing or empty credential: $($entry.Value)." }
      $envName = switch ($entry.Key) {
        'databaseUrl' { 'BACKUP_TASK_DATABASE_URL' }
        'encryptionKeyHex' { 'BACKUP_TASK_ENCRYPTION_KEY_HEX' }
        'r2AccessKeyId' { 'BACKUP_TASK_R2_ACCESS_KEY_ID' }
        'r2SecretAccessKey' { 'BACKUP_TASK_R2_SECRET_ACCESS_KEY' }
      }
      [Environment]::SetEnvironmentVariable($envName, $value, 'Process')
      $value = $null
    }

    $env:BACKUP_TASK_R2_ENDPOINT = 'https://b9f47a26b8f708444419dac863a54cd4.r2.cloudflarestorage.com'
    $env:BACKUP_TASK_R2_BUCKET = 'vela-database-backups'
    $logDirectory = Join-Path $env:LOCALAPPDATA 'Vela\backup-logs'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $logPath = Join-Path $logDirectory ("backup-r2-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
    $node = Get-Command node -ErrorAction Stop
    $runnerPath = Join-Path $PSScriptRoot 'backup-r2-task.mjs'
    & $node.Source $runnerPath 2>&1 | Tee-Object -FilePath $logPath -Append
    if ($LASTEXITCODE -ne 0) { throw 'The backup runner failed; see the sanitized log.' }
  }
  finally {
    foreach ($name in $environmentNames) {
      [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
  }
}

if ($SelfTest) { Test-CredentialStoreRoundTrip }
if ($StoreCredentials) { Save-BackupCredentials }
if ($InstallTask) { Install-BackupTask }
if ($Run) { Invoke-BackupTask }
