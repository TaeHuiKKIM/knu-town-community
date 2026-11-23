param([ValidateSet('Start','Stop','Reload')][string]$Action = 'Start', [switch]$OpenBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskRuntime = Join-Path $taskRoot '.runtime'
$taskStatePath = Join-Path $taskRuntime 'campus-host.json'
$launcherErrorPath = Join-Path $taskRuntime 'launcher-error.txt'
$taskExecutable = Join-Path $taskRuntime 'CampusHost.exe'
$taskEntry = Join-Path $taskRoot 'server.mjs'
$pathBytes = [Text.Encoding]::UTF8.GetBytes($taskRoot.ToUpperInvariant())
$pathHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($pathBytes)).Replace('-', '')
$taskRuleName = 'KnuTownCommunity-4183-' + $pathHash.Substring(0, 20)
$taskIsAdmin = ([Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

function Open-CampusBrowser {
    if ($OpenBrowser -and $Action -eq 'Start') {
        $state = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
        $hostIp = [Net.IPAddress]::Parse($state.address)
        if ($hostIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Invalid host address.' }
        Start-Process "http://${hostIp}:4183/r/main"
    }
}

if (-not $taskIsAdmin) {
    $params = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Action ' + $Action
    $elevated = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList $params -PassThru -Wait
    if ($elevated.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $launcherErrorPath) { throw (Get-Content -LiteralPath $launcherErrorPath -Raw) }
        throw 'Host action failed. Check Wi-Fi, port 4183, and .runtime/campus.err.log.'
    }
    Open-CampusBrowser
    return
}

function Remove-CampusFirewallRule {
    $rule = Get-NetFirewallRule -Name $taskRuleName -ErrorAction SilentlyContinue
    if ($rule -and ($rule | Get-NetFirewallApplicationFilter).Program -eq $taskExecutable) { $rule | Remove-NetFirewallRule }
}

function Stop-CampusHost {
    if (Test-Path -LiteralPath $taskStatePath) {
        $taskState = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
        $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskState.pid)" -ErrorAction SilentlyContinue
        if ($taskProcess -and $taskProcess.ExecutablePath -eq $taskExecutable -and $taskProcess.CommandLine.Contains($taskEntry)) { Stop-Process -Id $taskState.pid }
        Remove-Item -LiteralPath $taskStatePath
    }
    Remove-CampusFirewallRule
    Write-Host 'Campus host stopped.'
}

function Invoke-CampusAction {
    if (Test-Path -LiteralPath $launcherErrorPath) { Remove-Item -LiteralPath $launcherErrorPath }
    if ($Action -eq 'Stop') { Stop-CampusHost; return }
    $wireless = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.NdisPhysicalMedium -in 1,9 } | ForEach-Object { $_.ifIndex })
    $taskNetwork = Get-NetIPConfiguration | Where-Object { $_.IPv4Address -and $_.InterfaceIndex -in $wireless } | Sort-Object { if ($_.IPv4DefaultGateway) { 0 } else { 1 } } | Select-Object -First 1
    if (-not $taskNetwork) { throw 'Connect to Wi-Fi before starting the campus.' }
    $taskIp = ($taskNetwork.IPv4Address | Select-Object -First 1).IPAddress
    $taskProcess = $null
    if (Test-Path -LiteralPath $taskStatePath) {
        $taskPrevious = Get-Content -LiteralPath $taskStatePath -Raw | ConvertFrom-Json
        $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskPrevious.pid)" -ErrorAction SilentlyContinue
        if ($taskProcess -and ($taskProcess.ExecutablePath -ne $taskExecutable -or !$taskProcess.CommandLine.Contains($taskEntry))) {
            $taskProcess = $null
        }
    }
    $taskReuseRule = $false
    if ($taskProcess) {
        $taskListener = Get-NetTCPConnection -LocalPort 4183 -State Listen -LocalAddress $taskPrevious.address -ErrorAction SilentlyContinue
        if (!$taskListener -or $taskListener.OwningProcess -ne $taskProcess.ProcessId) { throw 'The running campus host could not be verified.' }
        $taskReuseRule = $taskPrevious.address -eq $taskIp
        if ($Action -eq 'Start' -and $taskReuseRule) {
            Write-Host "Campus is already running: http://${taskIp}:4183/r/main"
            Open-CampusBrowser
            return
        }
        if (Get-NetTCPConnection -OwningProcess $taskProcess.ProcessId -LocalPort 4183 -State Established -ErrorAction SilentlyContinue) {
            throw 'A campus connection is active. Open the host again after the room is empty.'
        }
        $taskRunning = Get-Process -Id $taskProcess.ProcessId
        $taskRunning.Kill()
        if (!$taskRunning.WaitForExit(5000)) { throw 'Campus host is still shutting down.' }
    } elseif ($Action -eq 'Reload') {
        throw 'The running campus host could not be verified.'
    }
    if (!$taskReuseRule) {
        if (Get-NetTCPConnection -LocalPort 4183 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 4183 is occupied. No process was stopped.' }
        New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
        Copy-Item -LiteralPath (Get-Command node -ErrorAction Stop).Source -Destination $taskExecutable -Force
        Remove-CampusFirewallRule
        New-NetFirewallRule -Name $taskRuleName -DisplayName 'KNU Campus - Wi-Fi only TCP 4183' -Direction Inbound -Action Allow -Enabled True -Profile Any -Protocol TCP -LocalPort 4183 -LocalAddress $taskIp -RemoteAddress Any -Program $taskExecutable -InterfaceAlias $taskNetwork.InterfaceAlias | Out-Null
    }
    $taskOldPort = $env:PORT; $taskOldBind = $env:STUDY_BIND
    try {
        $env:PORT = '4183'; $env:STUDY_BIND = $taskIp
        $taskHost = Start-Process -FilePath $taskExecutable -ArgumentList ('"' + $taskEntry + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskRuntime 'campus.log') -RedirectStandardError (Join-Path $taskRuntime 'campus.err.log') -PassThru
        @{pid=$taskHost.Id; address=$taskIp; firewallRule=$taskRuleName} | ConvertTo-Json | Set-Content -LiteralPath $taskStatePath
        $taskReady = $false
        for ($taskTry = 0; $taskTry -lt 30; $taskTry++) {
            if ($taskHost.HasExited) { throw 'Campus host stopped. Check .runtime/campus.err.log.' }
            try { if ((Invoke-RestMethod -Uri "http://${taskIp}:4183/health" -TimeoutSec 1).ok) { $taskReady = $true; break } } catch { Start-Sleep -Milliseconds 100 }
        }
        if (-not $taskReady) { throw 'Campus host did not become ready.' }
        Get-Content -LiteralPath (Join-Path $taskRuntime 'campus.log')
        Write-Host "Open http://${taskIp}:4183/r/main and choose Invite. Stop with STOP-CAMPUS.cmd."
    } catch {
        Stop-CampusHost
        throw
    }
    finally { $env:PORT = $taskOldPort; $env:STUDY_BIND = $taskOldBind }
    Open-CampusBrowser
}

$launcherMutex = [Threading.Mutex]::new($false, ('Global\' + $taskRuleName))
try {
    try { $locked = $launcherMutex.WaitOne(15000) } catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw 'Another host action is running. Try again shortly.' }
    Invoke-CampusAction
} catch {
    New-Item -ItemType Directory -Path $taskRuntime -Force | Out-Null
    $_.Exception.Message | Set-Content -LiteralPath $launcherErrorPath
    throw
} finally {
    if ($locked) { $launcherMutex.ReleaseMutex() }
    $launcherMutex.Dispose()
}
