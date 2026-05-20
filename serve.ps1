# Serves the Phi-3 chat UI on http://localhost:8080
$port = 8080
$root = $PSScriptRoot
Write-Host "Phi-3 chat UI: http://localhost:$port" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray
Set-Location $root
python -m http.server $port
