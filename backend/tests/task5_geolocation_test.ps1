# ProxiSpeak -- Task 5: Geolocation & Nearby Users -- PowerShell Test Script
# Paste the ENTIRE script into a single VS Code PowerShell terminal.
# Do NOT run line-by-line -- variables must share the same session.
# The backend must be running on port 5055 before you run this.

# ---- 0. Configuration -------------------------------------------------------
$baseUrl  = "http://127.0.0.1:5055"
$password = "TestPass123!"
$ts       = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$email    = "t5_main_$ts@proxispeak.test"
$email2   = "t5_near_$ts@proxispeak.test"

$pass = 0
$fail = 0

function Check($label, $expected, $actual, $extra) {
    if ($actual -eq $expected) {
        Write-Host "  PASS [$label] got=$actual $extra" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL [$label] expected=$expected got=$actual $extra" -ForegroundColor Red
        $script:fail++
    }
}

Write-Host ""
Write-Host "=== ProxiSpeak Task 5 -- Geolocation Test ===" -ForegroundColor Cyan
Write-Host "Base URL : $baseUrl"
Write-Host "Email 1  : $email"
Write-Host "Email 2  : $email2"
Write-Host ""

# ---- 1. Health check --------------------------------------------------------
Write-Host "--- 1. Health check ---" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/api/health" -Method GET
    Check "health" "True" "$($health.success)" ""
} catch {
    Write-Error "Health check FAILED -- is the backend running on port 5055?"
    return
}

# ---- 2. Register User 1 (main tester) --------------------------------------
Write-Host ""
Write-Host "--- 2. Register User 1 ---" -ForegroundColor Yellow
$regBody = @{ name = "Task5 User"; email = $email; password = $password } | ConvertTo-Json
try {
    $reg = Invoke-RestMethod -Uri "$baseUrl/api/users/register" `
        -Method POST -ContentType "application/json" -Body $regBody
    Check "register-user1" 201 201 ""
    Write-Host "  UserId: $($reg.user.id)"
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "register-user1" 201 $sc ""
    if ($sc -ne 409) { Write-Error "Registration failed -- stopping."; return }
}

# ---- 3. Register User 2 (nearby candidate) ----------------------------------
Write-Host ""
Write-Host "--- 3. Register User 2 ---" -ForegroundColor Yellow
$reg2Body = @{ name = "Nearby User"; email = $email2; password = $password } | ConvertTo-Json
try {
    $reg2 = Invoke-RestMethod -Uri "$baseUrl/api/users/register" `
        -Method POST -ContentType "application/json" -Body $reg2Body
    Check "register-user2" 201 201 ""
    Write-Host "  UserId: $($reg2.user.id)"
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "register-user2" 201 $sc ""
    if ($sc -ne 409) { Write-Error "Registration of User 2 failed -- stopping."; return }
}

# ---- 4. Login User 1 --------------------------------------------------------
Write-Host ""
Write-Host "--- 4. Login User 1 ---" -ForegroundColor Yellow
$loginBody = @{ email = $email; password = $password } | ConvertTo-Json
try {
    $login = Invoke-RestMethod -Uri "$baseUrl/api/users/login" `
        -Method POST -ContentType "application/json" -Body $loginBody
    Check "login-user1" 200 200 ""
    $token  = $login.token
    $userId = $login.user.id
    Write-Host "  Token (first 30): $($token.Substring(0,30))..."
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "login-user1" 200 $sc ""
    Write-Error "Login failed -- stopping."
    return
}
$headers = @{ Authorization = "Bearer $token" }

# ---- 5. Login User 2 --------------------------------------------------------
Write-Host ""
Write-Host "--- 5. Login User 2 ---" -ForegroundColor Yellow
$login2Body = @{ email = $email2; password = $password } | ConvertTo-Json
try {
    $login2 = Invoke-RestMethod -Uri "$baseUrl/api/users/login" `
        -Method POST -ContentType "application/json" -Body $login2Body
    Check "login-user2" 200 200 ""
    $token2  = $login2.token
    $user2Id = $login2.user.id
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "login-user2" 200 $sc ""
    Write-Error "Login User 2 failed -- stopping."
    return
}
$headers2 = @{ Authorization = "Bearer $token2" }

# ===========================================================================
# PUT /api/users/me/position
# ===========================================================================

# ---- 6. Valid position update (User 1 -> [300, 200]) -----------------------
Write-Host ""
Write-Host "--- 6. PUT /me/position valid [300,200] -- expect 200 ---" -ForegroundColor Yellow
$posBody = @{ position = @(300, 200) } | ConvertTo-Json
try {
    $putPos = Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" -Headers $headers -Body $posBody
    Check "put-position-valid" "True" "$($putPos.success)" "pos=$($putPos.user.position -join ',')"
    $noPwHash = ($null -eq $putPos.user.passwordHash)
    Check "put-position-no-pwdhash" "True" "$noPwHash" ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-valid" 200 $sc "$($_.ErrorDetails.Message)"
}

# ---- 7. Valid position update (User 2 -> [320, 210], ~26 px away) ----------
Write-Host ""
Write-Host "--- 7. PUT /me/position User2 -> [320,210] -- expect 200 ---" -ForegroundColor Yellow
$pos2Body = @{ position = @(320, 210) } | ConvertTo-Json
try {
    $putPos2 = Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" -Headers $headers2 -Body $pos2Body
    Check "put-position-user2" "True" "$($putPos2.success)" "pos=$($putPos2.user.position -join ',')"
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-user2" 200 $sc "$($_.ErrorDetails.Message)"
}

# ---- 8. Out-of-bounds x > 1000 -- expect 400 --------------------------------
Write-Host ""
Write-Host "--- 8. PUT /me/position x=1500 -- expect 400 ---" -ForegroundColor Yellow
$oobBody = @{ position = @(1500, 300) } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" -Headers $headers -Body $oobBody
    Check "put-position-oob-x" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-oob-x" 400 $sc ""
}

# ---- 9. Out-of-bounds y > 600 -- expect 400 ---------------------------------
Write-Host ""
Write-Host "--- 9. PUT /me/position y=800 -- expect 400 ---" -ForegroundColor Yellow
$oobYBody = @{ position = @(500, 800) } | ConvertTo-Json
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" -Headers $headers -Body $oobYBody
    Check "put-position-oob-y" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-oob-y" 400 $sc ""
}

# ---- 10. Position not an array -- expect 400 --------------------------------
Write-Host ""
Write-Host "--- 10. PUT /me/position not-an-array -- expect 400 ---" -ForegroundColor Yellow
$badTypeBody = '{"position":"not-an-array"}'
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" -Headers $headers -Body $badTypeBody
    Check "put-position-bad-type" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-bad-type" 400 $sc ""
}

# ---- 11. Position missing -- expect 400 -------------------------------------
Write-Host ""
Write-Host "--- 11. PUT /me/position missing field -- expect 400 ---" -ForegroundColor Yellow
$emptyBody = '{}'
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" -Headers $headers -Body $emptyBody
    Check "put-position-missing" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-missing" 400 $sc ""
}

# ---- 12. No token -- expect 401 --------------------------------------------
Write-Host ""
Write-Host "--- 12. PUT /me/position no token -- expect 401 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" -Body $posBody
    Check "put-position-no-token" 401 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-no-token" 401 $sc ""
}

# ---- 13. Invalid token -- expect 401 ----------------------------------------
Write-Host ""
Write-Host "--- 13. PUT /me/position invalid token -- expect 401 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/me/position" `
        -Method PUT -ContentType "application/json" `
        -Headers @{ Authorization = "Bearer not.a.real.token" } -Body $posBody
    Check "put-position-bad-token" 401 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "put-position-bad-token" 401 $sc ""
}

# ===========================================================================
# GET /api/users/nearby
# ===========================================================================

# ---- 14. radius=100 (User 2 is ~26 px away, should appear) -----------------
Write-Host ""
Write-Host "--- 14. GET /nearby?radius=100 expect User 2 present ---" -ForegroundColor Yellow
try {
    $nearby = Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=100" `
        -Method GET -Headers $headers
    Check "nearby-radius-100" "True" "$($nearby.success)" "count=$($nearby.count)"
    $u2Found = ($nearby.users | Where-Object { $_.id -eq $user2Id }) -ne $null
    Check "nearby-user2-present" "True" "$u2Found" ""
    $selfFound = ($nearby.users | Where-Object { $_.id -eq $userId }) -ne $null
    Check "nearby-self-excluded" "False" "$selfFound" ""
    $anyPwd = ($nearby.users | Where-Object { $null -ne $_.passwordHash }).Count -gt 0
    Check "nearby-no-pwdhash" "False" "$anyPwd" ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-radius-100" 200 $sc "$($_.ErrorDetails.Message)"
}

# ---- 15. radius=10 (User 2 ~26 px away, should NOT appear) -----------------
Write-Host ""
Write-Host "--- 15. GET /nearby?radius=10 User 2 should be absent ---" -ForegroundColor Yellow
try {
    $nearby2 = Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=10" `
        -Method GET -Headers $headers
    Check "nearby-radius-10-ok" "True" "$($nearby2.success)" ""
    $u2Found2 = ($nearby2.users | Where-Object { $_.id -eq $user2Id }) -ne $null
    Check "nearby-radius-10-absent" "False" "$u2Found2" "count=$($nearby2.count)"
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-radius-10-ok" 200 $sc "$($_.ErrorDetails.Message)"
}

# ---- 16. Missing radius -- expect 400 --------------------------------------
Write-Host ""
Write-Host "--- 16. GET /nearby (no radius) -- expect 400 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/nearby" -Method GET -Headers $headers
    Check "nearby-no-radius" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-no-radius" 400 $sc ""
}

# ---- 17. radius=0 -- expect 400 --------------------------------------------
Write-Host ""
Write-Host "--- 17. GET /nearby?radius=0 -- expect 400 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=0" -Method GET -Headers $headers
    Check "nearby-radius-zero" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-radius-zero" 400 $sc ""
}

# ---- 18. radius=-50 -- expect 400 ------------------------------------------
Write-Host ""
Write-Host "--- 18. GET /nearby?radius=-50 -- expect 400 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=-50" -Method GET -Headers $headers
    Check "nearby-radius-negative" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-radius-negative" 400 $sc ""
}

# ---- 19. radius=abc -- expect 400 ------------------------------------------
Write-Host ""
Write-Host "--- 19. GET /nearby?radius=abc -- expect 400 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=abc" -Method GET -Headers $headers
    Check "nearby-radius-string" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-radius-string" 400 $sc ""
}

# ---- 20. radius=9999 exceeds canvas diagonal (1166 px) -- expect 400 -------
Write-Host ""
Write-Host "--- 20. GET /nearby?radius=9999 exceeds max -- expect 400 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=9999" -Method GET -Headers $headers
    Check "nearby-radius-too-large" 400 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-radius-too-large" 400 $sc ""
}

# ---- 21. No token -- expect 401 --------------------------------------------
Write-Host ""
Write-Host "--- 21. GET /nearby no token -- expect 401 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=100" -Method GET
    Check "nearby-no-token" 401 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-no-token" 401 $sc ""
}

# ---- 22. Invalid token -- expect 401 ----------------------------------------
Write-Host ""
Write-Host "--- 22. GET /nearby invalid token -- expect 401 ---" -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "$baseUrl/api/users/nearby?radius=100" `
        -Method GET -Headers @{ Authorization = "Bearer not.a.real.token" }
    Check "nearby-bad-token" 401 200 ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "nearby-bad-token" 401 $sc ""
}

# ===========================================================================
# Regression: existing Tasks 1-4 endpoints still work
# ===========================================================================

Write-Host ""
Write-Host "--- 23. Regression: GET /me still works ---" -ForegroundColor Yellow
try {
    $me = Invoke-RestMethod -Uri "$baseUrl/api/users/me" -Method GET -Headers $headers
    Check "regression-get-me" "True" "$($me.success)" ""
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "regression-get-me" 200 $sc ""
}

Write-Host ""
Write-Host "--- 24. Regression: PATCH /me still works ---" -ForegroundColor Yellow
$patchBody = @{ name = "Task5 Patched" } | ConvertTo-Json
try {
    $patch = Invoke-RestMethod -Uri "$baseUrl/api/users/me" `
        -Method PATCH -ContentType "application/json" -Headers $headers -Body $patchBody
    Check "regression-patch-me" "True" "$($patch.success)" "name=$($patch.user.name)"
} catch {
    $sc = $_.Exception.Response.StatusCode.value__
    Check "regression-patch-me" 200 $sc ""
}

# ---- Summary ----------------------------------------------------------------
Write-Host ""
Write-Host "=== RESULTS ===" -ForegroundColor Cyan
Write-Host "PASSED : $pass" -ForegroundColor Green
if ($fail -gt 0) {
    Write-Host "FAILED : $fail" -ForegroundColor Red
} else {
    Write-Host "FAILED : $fail" -ForegroundColor Green
}
Write-Host "TOTAL  : $($pass + $fail)"
Write-Host ""
