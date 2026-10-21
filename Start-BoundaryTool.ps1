param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
try {
    try {
        $taskHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:8766/api/health' -TimeoutSec 2
        if ($taskHealth.workflow -eq 'manual-energyplus') {
            if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8766/' }
            return
        }
    } catch { }
$taskPython = $env:BOUNDARY_PYTHON
if (-not $taskPython) {
    $taskCandidates = @((Join-Path $env:USERPROFILE 'miniconda3/python.exe'), (Join-Path $env:USERPROFILE 'AppData/Local/Programs/Python/Python313/python.exe'))
    $taskPython = $taskCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $taskPython) {
    $taskCommand = Get-Command python -ErrorAction SilentlyContinue
    if ($taskCommand) { $taskPython = $taskCommand.Source }
}
if (-not $taskPython) { throw 'Python 3.11+ is required. Set BOUNDARY_PYTHON to python.exe.' }
& $taskPython -c "import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ is required. Set BOUNDARY_PYTHON to python.exe.' }
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.python-deps/shapely'))) {
    & $taskPython -m pip install --target (Join-Path $PSScriptRoot '.python-deps') -r (Join-Path $PSScriptRoot 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
$taskArgs = @((Join-Path $PSScriptRoot 'start_pipeline.py'))
if ($NoBrowser) { $taskArgs += '--no-browser' }
& $taskPython @taskArgs
if ($LASTEXITCODE -ne 0) { throw 'Boundary Tool could not start. Check that port 8766 is free.' }
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show($_.Exception.Message, 'Boundary Tool') | Out-Null
}
