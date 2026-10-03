<#
  dsh-restart-button - restart helper for the DeepSeek Harness desktop app (Windows).

  Started detached by the plugin's Host half. The whole spec arrives as JSON in
  $env:DSH_RESTART_SPEC:
    mainPid            Electron main process (parent of the Host)
    hostPid            Host process (Electron in Node mode) that started this helper
    exe                Application executable to start again
    port               Web port the Host listens on (0 = do not wait for it)
    statusFile         File this helper writes its progress into (read by the Host)
    logFile            Append-only log file
    startDelayMs       Pause after "verified" so the HTTP answer reaches the window
    hostExitTimeoutSec How long the Host may take to tear down gracefully
    dryRun             Verify and report only; never suspend, stop, or start anything

  Sequence:
    1. verify: mainPid runs exe, and hostPid is a child of mainPid
    2. write "verified", wait startDelayMs
    3. suspend the Electron main process so it cannot react to the Host leaving
       (no crash dialog, no crash report), write "ready suspended"
       (or "ready unsuspended" when suspension is impossible)
    4. the Host disconnects from the shell and tears down gracefully; wait for it
       (terminate it after hostExitTimeoutSec)
    5. terminate the frozen main process and its leftover Chromium children
    6. wait for the Web port to be released, start exe with its original arguments

  This file is ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less
  scripts in the ANSI code page).
#>

$ErrorActionPreference = 'Stop'

$spec = $env:DSH_RESTART_SPEC | ConvertFrom-Json
# Nothing of the helper's own wiring may leak into the relaunched application.
foreach ($name in @('DSH_RESTART_SPEC', 'DSH_RESTART_SCRIPT', 'ELECTRON_RUN_AS_NODE')) {
  Remove-Item -LiteralPath ('Env:' + $name) -ErrorAction SilentlyContinue
}

$MainPid = [int]$spec.mainPid
$HostPid = [int]$spec.hostPid
$Exe = [string]$spec.exe
$Port = [int]$spec.port
$StatusFile = [string]$spec.statusFile
$LogFile = [string]$spec.logFile
$StartDelayMs = if ($null -ne $spec.startDelayMs) { [int]$spec.startDelayMs } else { 700 }
$HostExitTimeoutSec = if ($null -ne $spec.hostExitTimeoutSec) { [int]$spec.hostExitTimeoutSec } else { 15 }
$DryRun = [bool]$spec.dryRun
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Write-Log([string]$Message) {
  try {
    $dir = [System.IO.Path]::GetDirectoryName($LogFile)
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { [void][System.IO.Directory]::CreateDirectory($dir) }
    $line = '[{0}] [helper {1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss.fff'), $PID, $Message
    [System.IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine, $Utf8)
  } catch {}
}

function Set-HelperStatus([string]$Value) {
  try {
    $tmp = '{0}.{1}.tmp' -f $StatusFile, $PID
    [System.IO.File]::WriteAllText($tmp, $Value, $Utf8)
    Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
  } catch {
    Write-Log ('could not write status "{0}": {1}' -f $Value, $_.Exception.Message)
  }
}

function Get-ProcInfo([int]$Id) {
  return Get-CimInstance -ClassName Win32_Process -Filter ('ProcessId = {0}' -f $Id) -ErrorAction SilentlyContinue
}

function Get-ArgumentTail([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return '' }
  $s = $CommandLine.TrimStart()
  if ($s.StartsWith('"')) {
    $end = $s.IndexOf('"', 1)
    if ($end -lt 0) { return '' }
    return $s.Substring($end + 1).Trim()
  }
  $space = $s.IndexOf(' ')
  if ($space -lt 0) { return '' }
  return $s.Substring($space + 1).Trim()
}

function Test-SamePath([string]$A, [string]$B) {
  if ([string]::IsNullOrWhiteSpace($A) -or [string]::IsNullOrWhiteSpace($B)) { return $false }
  return [string]::Equals([System.IO.Path]::GetFullPath($A), [System.IO.Path]::GetFullPath($B), [System.StringComparison]::OrdinalIgnoreCase)
}

function Test-PortListening([int]$P) {
  # The listener table answers at once; a loopback connect probe to a closed port
  # takes about two seconds on Windows before it is refused.
  try {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    return @($listeners | Where-Object { $_.Port -eq $P }).Count -gt 0
  } catch {
    return $false
  }
}

function Wait-ProcessGone([int]$Id, [int]$TimeoutMs) {
  $proc = Get-Process -Id $Id -ErrorAction SilentlyContinue
  if ($null -eq $proc) { return $true }
  try { return $proc.WaitForExit($TimeoutMs) } catch { return ($null -eq (Get-Process -Id $Id -ErrorAction SilentlyContinue)) }
}

# ---------------------------------------------------------------- 1. verify
try {
  Write-Log ('start: main={0} host={1} exe="{2}" port={3} dryRun={4}' -f $MainPid, $HostPid, $Exe, $Port, $DryRun)
  $main = Get-ProcInfo $MainPid
  if ($null -eq $main) { throw ('main process {0} is not running' -f $MainPid) }
  if (-not (Test-SamePath $main.ExecutablePath $Exe)) { throw ('process {0} runs "{1}", not "{2}"' -f $MainPid, $main.ExecutablePath, $Exe) }
  $hostInfo = Get-ProcInfo $HostPid
  if ($null -eq $hostInfo) { throw ('host process {0} is not running' -f $HostPid) }
  if ([int]$hostInfo.ParentProcessId -ne $MainPid) { throw ('host {0} has parent {1}, not {2}' -f $HostPid, $hostInfo.ParentProcessId, $MainPid) }
  $relaunchArgs = Get-ArgumentTail ([string]$main.CommandLine)
  $children = @(Get-CimInstance -ClassName Win32_Process -Filter ('ParentProcessId = {0}' -f $MainPid) -ErrorAction SilentlyContinue |
    Where-Object { [int]$_.ProcessId -ne $HostPid -and (Test-SamePath $_.ExecutablePath $Exe) } |
    ForEach-Object { [int]$_.ProcessId })
  Write-Log ('verified: relaunch arguments [{0}], shell children [{1}]' -f $relaunchArgs, ($children -join ','))

  Add-Type -Namespace DshRestartButton -Name Native -MemberDefinition @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
[DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr handle);
[DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr handle);
'@
} catch {
  $reason = $_.Exception.Message
  Write-Log ('abort before any change: {0}' -f $reason)
  Set-HelperStatus ('failed: {0}' -f $reason)
  exit 2
}

if ($DryRun) {
  Write-Log 'dry run: verification passed; nothing was suspended, stopped or started'
  Set-HelperStatus ('dryrun ok args=[{0}] children=[{1}]' -f $relaunchArgs, ($children -join ','))
  exit 0
}

Set-HelperStatus 'verified'

# ---------------------------------------------------------------- 2.-6. restart
try {
  Start-Sleep -Milliseconds $StartDelayMs

  # 3. freeze the Electron shell so the Host's departure is never observed
  $suspended = $false
  $handle = [DshRestartButton.Native]::OpenProcess(0x0800, $false, $MainPid) # PROCESS_SUSPEND_RESUME
  if ($handle -ne [IntPtr]::Zero) {
    $rc = [DshRestartButton.Native]::NtSuspendProcess($handle)
    [void][DshRestartButton.Native]::CloseHandle($handle)
    $suspended = ($rc -eq 0)
    Write-Log ('NtSuspendProcess({0}) -> 0x{1:X8}' -f $MainPid, $rc)
  } else {
    Write-Log ('OpenProcess({0}) failed with Win32 error {1}' -f $MainPid, [System.Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
  if ($suspended) { Set-HelperStatus 'ready suspended' } else { Set-HelperStatus 'ready unsuspended' }

  # 4. graceful Host teardown (it disconnects as soon as it reads "ready")
  if (Wait-ProcessGone $HostPid ($HostExitTimeoutSec * 1000)) {
    Write-Log 'host exited'
  } else {
    Write-Log ('host still running after {0}s; terminating it' -f $HostExitTimeoutSec)
    Stop-Process -Id $HostPid -Force -ErrorAction SilentlyContinue
    [void](Wait-ProcessGone $HostPid 5000)
  }

  # 5. end the frozen shell and whatever Chromium helpers outlive it
  Stop-Process -Id $MainPid -Force -ErrorAction SilentlyContinue
  if (Wait-ProcessGone $MainPid 10000) { Write-Log 'main exited' } else { Write-Log 'main did not exit within 10s' }
  foreach ($childPid in $children) {
    if (-not (Wait-ProcessGone $childPid 4000)) {
      $leftover = Get-Process -Id $childPid -ErrorAction SilentlyContinue
      if ($null -ne $leftover -and (Test-SamePath $leftover.Path $Exe)) {
        Write-Log ('terminating leftover shell child {0}' -f $childPid)
        Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue
      }
    }
  }

  # 6. wait for the Web port, then start the application again
  if ($Port -gt 0) {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Test-PortListening $Port) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 250 }
    if (Test-PortListening $Port) { Write-Log ('port {0} is still in use; starting anyway' -f $Port) } else { Write-Log ('port {0} is free' -f $Port) }
  }

  $startArgs = @{ FilePath = $Exe; WorkingDirectory = [System.IO.Path]::GetDirectoryName($Exe); PassThru = $true }
  if (-not [string]::IsNullOrWhiteSpace($relaunchArgs)) { $startArgs.ArgumentList = $relaunchArgs }
  $started = $null
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    $started = Start-Process @startArgs
    Write-Log ('started "{0}" as pid {1} (attempt {2})' -f $Exe, $started.Id, $attempt)
    Start-Sleep -Seconds 3
    if (-not $started.HasExited) { break }
    Write-Log ('pid {0} exited early with code {1}' -f $started.Id, $started.ExitCode)
    # Exit code 0 is a deliberate hand-off (launcher stub, single-instance forward); only retry failures.
    if ($started.ExitCode -eq 0) { break }
    Start-Sleep -Seconds 2
  }
  Write-Log 'restart complete'
  Remove-Item -LiteralPath $StatusFile -ErrorAction SilentlyContinue
} catch {
  Write-Log ('restart failed: {0}' -f $_.Exception.Message)
  Set-HelperStatus ('failed: {0}' -f $_.Exception.Message)
  # Never leave the shell frozen: if it still exists, let it run again.
  try {
    $h = [DshRestartButton.Native]::OpenProcess(0x0800, $false, $MainPid)
    if ($h -ne [IntPtr]::Zero) { [void][DshRestartButton.Native]::NtResumeProcess($h); [void][DshRestartButton.Native]::CloseHandle($h) }
  } catch {}
  exit 3
}
exit 0
