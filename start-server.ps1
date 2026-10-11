# ============================================================
#  TRANSPORT MANAGER — START SERVER + PUBLIC TUNNEL
#  Run this script: Right-click → "Run with PowerShell"
# ============================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "   TRANSPORT MANAGER STARTUP" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

# Kill any existing server on port 4000
$existing = Get-NetTCPConnection -LocalPort 4000 -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Stopping old server on port 4000..." -ForegroundColor Cyan
    $existing | ForEach-Object {
        Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 1
}

# Start the Node.js backend server in a new window
Write-Host "Starting backend server..." -ForegroundColor Green
$serverScript = Join-Path $PSScriptRoot "backend\server.mjs"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "node `"$serverScript`"" -WindowStyle Normal

# Give server time to start
Start-Sleep -Seconds 2

# Check if ngrok is configured
$ngrokConfig = "$env:USERPROFILE\.config\ngrok\ngrok.yml"
$needsToken = $true

if (Test-Path $ngrokConfig) {
    $content = Get-Content $ngrokConfig -Raw
    if ($content -match "authtoken") {
        $needsToken = $false
    }
}

if ($needsToken) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Red
    Write-Host "  NGROK SETUP REQUIRED (one time only)" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "1. Open this URL in browser:" -ForegroundColor White
    Write-Host "   https://dashboard.ngrok.com/signup" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "2. Sign up FREE (use Google/GitHub login)" -ForegroundColor White
    Write-Host ""
    Write-Host "3. After login, go to:" -ForegroundColor White
    Write-Host "   https://dashboard.ngrok.com/get-started/your-authtoken" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "4. Copy your authtoken and run this command:" -ForegroundColor White
    Write-Host "   ngrok config add-authtoken YOUR_TOKEN_HERE" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "5. Then run this script again!" -ForegroundColor White
    Write-Host ""
    Write-Host "OR: Drivers can still use LAN URL if on same WiFi:" -ForegroundColor Gray

    # Show LAN IP
    $lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
    if ($lanIp) {
        Write-Host "   http://${lanIp}:4000" -ForegroundColor Green
    }
} else {
    # Start ngrok tunnel
    Write-Host "Starting ngrok public tunnel..." -ForegroundColor Green
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "ngrok http 4000 --log=stdout" -WindowStyle Normal

    Start-Sleep -Seconds 3

    # Get the public URL from ngrok API
    try {
        $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction Stop
        $publicUrl = $tunnels.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -ExpandProperty public_url -First 1
        if (-not $publicUrl) {
            $publicUrl = $tunnels.tunnels | Select-Object -ExpandProperty public_url -First 1
        }

        Write-Host ""
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host "  SERVER IS LIVE — SHARE WITH DRIVERS" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  PUBLIC URL (works from ANYWHERE):" -ForegroundColor White
        Write-Host "  $publicUrl" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  LAN URL (same WiFi only):" -ForegroundColor Gray
        $lanIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.PrefixOrigin -ne "WellKnown" } | Select-Object -First 1).IPAddress
        if ($lanIp) { Write-Host "  http://${lanIp}:4000" -ForegroundColor Gray }
        Write-Host ""
        Write-Host "  Admin login: http://localhost:4000" -ForegroundColor White
        Write-Host "========================================" -ForegroundColor Yellow

        # Copy URL to clipboard
        $publicUrl | Set-Clipboard
        Write-Host ""
        Write-Host "  URL copied to clipboard!" -ForegroundColor Green

    } catch {
        Write-Host ""
        Write-Host "Ngrok is starting... Check the ngrok window for your public URL." -ForegroundColor Yellow
        Write-Host "Also check: http://localhost:4040" -ForegroundColor Cyan
    }
}

Write-Host ""
Write-Host "Press any key to exit this window..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
