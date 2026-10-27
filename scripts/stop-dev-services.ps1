<#
Stops everything the local launcher previously started: the npm wrappers, the
tsx/Vite supervisors, their children, and the cmd windows opened by `start`.

Killing only the PID that owns the port is not enough. `tsx watch` and Vite
supervise their child and respawn it at once, so the port is taken again before
the new server can bind. `taskkill /T` on the supervisor takes the whole tree.

Safe by construction: node processes are only touched when their command line
points into this checkout AND names a dev server; cmd processes only when they
run this launcher's own dev scripts.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectRoot,
  [Parameter(Mandatory)][string]$Port
)

$ErrorActionPreference = 'Stop'
# `-File` binds 4010,5183 as an int array, and a [string] parameter flattens it
# back to "4010 5183"; split it into a separate variable because assigning to a
# typed parameter re-coerces it to the declared type.
$ports = @("$Port" -split '[,;\s]+' | Where-Object { $_ } | ForEach-Object { [int]$_ })
# The batch launcher passes "<dir>\." because a trailing backslash before the
# closing quote would escape it; GetFullPath folds that back to the plain path.
$root = [regex]::Escape([System.IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\', '/'))
$targets = [System.Collections.Generic.HashSet[int]]::new()

foreach ($p in $ports) {
  Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
    ForEach-Object { [void]$targets.Add([int]$_.OwningProcess) }
}

Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match $root -and $_.CommandLine -match '(tsx|vite)' } |
  ForEach-Object { [void]$targets.Add([int]$_.ProcessId) }

Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match 'npm(\.cmd)?\s+run\s+dev:(api|web)' } |
  ForEach-Object { [void]$targets.Add([int]$_.ProcessId) }

if ($targets.Count -eq 0) {
  Write-Host 'No existing dev service found.'
  exit 0
}

foreach ($procId in $targets) {
  & taskkill.exe /F /T /PID $procId *> $null
}

# A supervisor that survived would take the port back; confirm it is really free.
$deadline = (Get-Date).AddSeconds(15)
while ($true) {
  $busy = @($ports | Where-Object {
      Get-NetTCPConnection -State Listen -LocalPort $_ -ErrorAction SilentlyContinue
    })
  if ($busy.Count -eq 0) { break }
  if ((Get-Date) -ge $deadline) {
    Write-Host "ERROR: port still in use after cleanup: $($busy -join ', ')"
    exit 1
  }
  Start-Sleep -Milliseconds 500
}

Write-Host "Stopped $($targets.Count) existing dev service process(es)."
exit 0
