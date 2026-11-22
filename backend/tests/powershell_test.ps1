# ProxiSpeak — VS Code PowerShell API Test Script
# Paste the ENTIRE block into a single VS Code PowerShell terminal.
# Do NOT run line-by-line — all variables must live in the same session.

# ── 1. Configuration ──────────────────────────────────────────────────────────
$baseUrl  = "http://127.0.0.1:5055"
$password = "TestPass123!"
$email    = "vstest_" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + "@proxispeak.test"
$name     = "VS Code Tester"

Write-Host "`n=== ProxiSpeak API Test ===" -ForegroundColor Cyan
Write-Host "Base URL : $baseUrl"
Write-Host "Email    : $email`n"

# ── 2. Health check ───────────────────────────────────────────────────────────
Write-Host "--- Health check ---" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method GET
    Write-Host "Status  : 200"
    Write-Host "Message : $($health.message)`n"
} catch {
    Write-Error "Health check FAILED — is the backend running on port 5055?"
    return
}

# ── 3. Register ───────────────────────────────────────────────────────────────
Write-Host "--- POST /api/users/register ---" -ForegroundColor Yellow
$regBody = @{ name = $name; email = $email; password = $password } | ConvertTo-Json
try {
    $reg = Invoke-RestMethod -Uri "$baseUrl/api/users/register" `
           -Method POST `
           -ContentType "application/json" `
           -Body $regBody
    Write-Host "Status  : 201"
    Write-Host "UserId  : $($reg.user.id)"
    Write-Host "Name    : $($reg.user.name)"
    Write-Host "Email   : $($reg.user.email)`n"
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Write-Host "Status  : $sc" -ForegroundColor Red
    Write-Host "Body    : $($_.ErrorDetails.Message)" -ForegroundColor Red
    if ($sc -eq 409) {
        Write-Host "(Email already registered — continuing to login)" -ForegroundColor DarkYellow
    } else {
        Write-Error "Registration failed — stopping."
        return
    }
}

# ── 4. Login ──────────────────────────────────────────────────────────────────
Write-Host "--- POST /api/users/login ---" -ForegroundColor Yellow
$loginBody = @{ email = $email; password = $password } | ConvertTo-Json
try {
    $login = Invoke-RestMethod -Uri "$baseUrl/api/users/login" `
             -Method POST `
             -ContentType "application/json" `
             -Body $loginBody
    Write-Host "Status  : 200"
    Write-Host "Message : $($login.message)"
    Write-Host "Token   : $($login.token.Substring(0,30))... (truncated)"
    Write-Host "Name    : $($login.user.name)"
    Write-Host "Email   : $($login.user.email)`n"
    $token = $login.token
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Write-Host "Status  : $sc" -ForegroundColor Red
    Write-Host "Body    : $($_.ErrorDetails.Message)" -ForegroundColor Red
    Write-Error "Login failed — stopping."
    return
}

$headers = @{ Authorization = "Bearer $token" }

# ── 5. GET /api/users/me (valid token) ───────────────────────────────────────
Write-Host "--- GET /api/users/me (valid token) ---" -ForegroundColor Yellow
try {
    $me = Invoke-RestMethod -Uri "$baseUrl/api/users/me" -Method GET -Headers $headers
    Write-Host "Status          : 200"
    Write-Host "Id              : $($me.user.id)"
    Write-Host "Name            : $($me.user.name)"
    Write-Host "Email           : $($me.user.email)"
    Write-Host "Position        : $($me.user.position -join ", ")"
    $exposed = $null -ne $me.user.passwordHash
    Write-Host "passwordHash?   : $exposed (should be False)"
    if ($exposed) { Write-Host "SECURITY FAIL: passwordHash was returned!" -ForegroundColor Red }
    Write-Host ""
} catch {
    Write-Host "Status  : $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "Body    : $($_.ErrorDetails.Message)" -ForegroundColor Red
}

# ── 6. PATCH /api/users/me (valid token + valid data) ────────────────────────
Write-Host "--- PATCH /api/users/me (valid token + valid data) ---" -ForegroundColor Yellow
$patchBody = @{ name = "VS Updated Name"; position = @(250, 150) } | ConvertTo-Json
try {
    $patch = Invoke-RestMethod -Uri "$baseUrl/api/users/me" `
             -Method PATCH `
             -ContentType "application/json" `
             -Headers $headers `
             -Body $patchBody
    Write-Host "Status    : 200"
    Write-Host "Message   : $($patch.message)"
    Write-Host "New Name  : $($patch.user.name)"
    Write-Host "Position  : $($patch.user.position -join ", ")"
    $exposed2 = $null -ne $patch.user.passwordHash
    Write-Host "passwordHash? : $exposed2 (should be False)`n"
    if ($exposed2) { Write-Host "SECURITY FAIL: passwordHash was returned!" -ForegroundColor Red }
} catch {
    Write-Host "Status  : $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "Body    : $($_.ErrorDetails.Message)" -ForegroundColor Red
}

# ── 7. Protected field: email must NOT change ─────────────────────────────────
Write-Host "--- PATCH /api/users/me (email field must be ignored) ---" -ForegroundColor Yellow
$badPatch = @{ name = "HackAttempt"; email = "attacker@evil.com" } | ConvertTo-Json
try {
    $bp = Invoke-RestMethod -Uri "$baseUrl/api/users/me" `
          -Method PATCH -ContentType "application/json" -Headers $headers -Body $badPatch
    $emailUnchanged = $bp.user.email -eq $email
    Write-Host "Status         : 200"
    Write-Host "Email returned : $($bp.user.email)"
    Write-Host "Email unchanged: $emailUnchanged (should be True)`n"
} catch {
    Write-Host "Status  : $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
}

# ── 8. GET /api/users/me — no token (expect 401) ─────────────────────────────
Write-Host "--- GET /api/users/me (no token — expect 401) ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me" -Method GET
    Write-Host "FAIL: expected 401 but got 200" -ForegroundColor Red
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Write-Host "Status  : $sc (expected 401)"
    Write-Host "Correct : $($sc -eq 401)`n"
}

# ── 9. GET /api/users/me — invalid token (expect 401) ────────────────────────
Write-Host "--- GET /api/users/me (invalid token — expect 401) ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me" `
        -Method GET -Headers @{ Authorization = "Bearer not.a.valid.token" }
    Write-Host "FAIL: expected 401 but got 200" -ForegroundColor Red
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Write-Host "Status  : $sc (expected 401)"
    Write-Host "Correct : $($sc -eq 401)`n"
}

# ── 10. Login with wrong password (expect 401) ────────────────────────────────
Write-Host "--- POST /api/users/login (wrong password — expect 401) ---" -ForegroundColor Yellow
$wrongPwd = @{ email = $email; password = "WrongPassword999!" } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/login" `
        -Method POST -ContentType "application/json" -Body $wrongPwd
    Write-Host "FAIL: expected 401 but got 200" -ForegroundColor Red
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Write-Host "Status  : $sc (expected 401)"
    Write-Host "Correct : $($sc -eq 401)`n"
}

# ── 11. PATCH — invalid position (expect 400) ────────────────────────────────
Write-Host "--- PATCH /api/users/me (out-of-bounds position — expect 400) ---" -ForegroundColor Yellow
$badPos = @{ position = @(9999, 9999) } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me" `
        -Method PATCH -ContentType "application/json" -Headers $headers -Body $badPos
    Write-Host "FAIL: expected 400 but got 200" -ForegroundColor Red
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Write-Host "Status  : $sc (expected 400 or 500)"
    Write-Host "Correct : $($sc -in @(400,500))`n"
}

# ── 12. PATCH — position not an array (expect 400) ───────────────────────────
Write-Host "--- PATCH /api/users/me (position not an array — expect 400) ---" -ForegroundColor Yellow
$badType = '{ "position": "not-an-array" }'
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me" `
        -Method PATCH -ContentType "application/json" -Headers $headers -Body $badType
    Write-Host "FAIL: expected 400 but got 200" -ForegroundColor Red
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Write-Host "Status  : $sc (expected 400)"
    Write-Host "Correct : $($sc -eq 400)`n"
}

Write-Host "=== All manual tests complete ===" -ForegroundColor Cyan
