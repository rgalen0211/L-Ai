# SITTING BLOCK 4: every function deploy of the sitting, ONE PowerShell paste (GEO, Wed 11-25). Run it only after paste 3 said PASS.
# It covers: step 2 (F1-F5 + guided-builder), 3b's P1-P3.1 (the two purge secrets, made and set without ever printing them, and
# purge-partial-uploads), and step 3, the buying lock (Q673 check 1 row 6 is FALSE: it only LOOKS for stripe-checkout).
# Every deploy ends with --no-verify-jwt (there is no config.toml; without it sign-ups and invite codes are refused).
# Open this file in Notepad, copy ALL, paste into PowerShell, press Enter. It stops at the first error and says STOP in red.
# PASS = the last green line reads 'PASS: 8 functions deployed ...'. Never paste a secret value into chat.
& {
    $ref = 'jxtkfishqfxuptwjzczz'
    $tue = 'eca5cf8b8ddd3d48ce07025de1002c26b88f007d'
    Set-Location C:\Users\Ryan\Documents\GitHub\L-Ai
    $head = git rev-parse HEAD
    if ($head -ne $tue) { Write-Host "STOP: L-Ai is on $head, not the Tuesday commit. Do step 0 first." -ForegroundColor Red; return }
    if (git status --porcelain) { Write-Host 'STOP: the L-Ai folder has changed files; the deploys would send them. Tell GEO.' -ForegroundColor Red; return }
    # 3b P2: the two purge secrets, 64 characters each, into a file in your own folder; nothing is printed
    if (-not (Test-Path "$HOME\purge-secrets.env")) {
        $r = [Security.Cryptography.RandomNumberGenerator]::Create(); $a = New-Object byte[] 32; $c = New-Object byte[] 32; $r.GetBytes($a); $r.GetBytes($c)
        [IO.File]::WriteAllText("$HOME\purge-secrets.env", "PURGE_UPLOADS_SECRET=" + (-join ($a | ForEach-Object { $_.ToString('x2') })) + "`nPURGE_PARTIAL_SECRET=" + (-join ($c | ForEach-Object { $_.ToString('x2') })) + "`n")
        Remove-Variable a, c, r
    }
    # 3b P3 part 1: the function side of the two secrets (BEFORE the deploys, so no second deploy is needed)
    npx.cmd supabase secrets set --env-file "$HOME\purge-secrets.env" --project-ref $ref
    if ($LASTEXITCODE -ne 0) { Write-Host 'STOP: setting the two purge secrets failed. Send GEO the red lines.' -ForegroundColor Red; return }
    # step 2 (F1 delete-account, F2 ai-editor + film-page, F3 ops-tick, F4 connect, F5 purge-uploads, guided-builder) and 3b P1 (purge-partial-uploads)
    $fns = 'delete-account', 'ai-editor', 'film-page', 'ops-tick', 'connect', 'purge-uploads', 'purge-partial-uploads', 'guided-builder'
    foreach ($f in $fns) {
        Write-Host "deploying $f ..." -ForegroundColor Cyan
        npx.cmd supabase functions deploy $f --project-ref $ref --no-verify-jwt
        if ($LASTEXITCODE -ne 0) { Write-Host "STOP: the deploy of $f failed; the ones before it are deployed. Send GEO the red lines." -ForegroundColor Red; return }
    }
    # step 3, the buying lock: row 6 FALSE = do NOT apply any payment SQL; only look whether stripe-checkout is deployed
    $list = npx.cmd supabase functions list --project-ref $ref | Out-String
    if ($LASTEXITCODE -ne 0) { Write-Host 'STOP: could not list the functions, so the buying lock is NOT checked (the 8 deploys ARE done). Look in Dashboard > Edge Functions for stripe-checkout and tell GEO.' -ForegroundColor Red; return }
    if ($list -match 'stripe-checkout') {
        Write-Host 'BUYING LOCK: stripe-checkout IS deployed. Delete it now: Dashboard > Edge Functions > stripe-checkout > Delete function (section 2a b).' -ForegroundColor Yellow
    } else {
        Write-Host 'BUYING LOCK: stripe-checkout is not deployed: nothing to lock.' -ForegroundColor Green
    }
    Write-Host "PASS: 8 functions deployed with --no-verify-jwt from $tue, and the purge secrets are set. Next: the two Vault copies (paper 3b P3 part 2)." -ForegroundColor Green
}
