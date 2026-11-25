# SITTING BLOCK 5: step 4 (push L-Ai main to the Tuesday commit) and 4a (redeem-invite), ONE PowerShell paste (GEO, Wed 11-25).
# Run it only after block 4 said PASS (steps 1 to 3 done). The purge-jobs SQL (live steps 54 and 55) may come before or after it.
# It never forces: 'rejected' means STOP and tell CC1. Open in Notepad, copy ALL, paste into PowerShell, press Enter.
# PASS = the last green line reads 'PASS: L-Ai main is ...'. WRITE DOWN the yellow 'origin/main was' line: it is the undo target.
& {
    $ref = 'jxtkfishqfxuptwjzczz'
    $tue = 'eca5cf8b8ddd3d48ce07025de1002c26b88f007d'
    Set-Location C:\Users\Ryan\Documents\GitHub\L-Ai
    if ((git rev-parse HEAD) -ne $tue) { Write-Host 'STOP: L-Ai is not on the Tuesday commit.' -ForegroundColor Red; return }
    git fetch origin
    $was = git rev-parse origin/main
    Write-Host "WRITE THIS DOWN (the undo target): origin/main was $was" -ForegroundColor Yellow
    git push origin "${tue}:refs/heads/main"
    if ($LASTEXITCODE -ne 0) { Write-Host 'STOP: the push was refused (never force it). Tell CC1.' -ForegroundColor Red; return }
    $now = ((git ls-remote origin refs/heads/main) -split '\s+')[0]
    if ($now -ne $tue) { Write-Host "STOP: origin main is $now after the push, not the Tuesday commit. Tell CC1." -ForegroundColor Red; return }
    # 4a: redeem-invite from the Tuesday commit, right after the push (it needs the page's 18+ tick, which the push just put live)
    npx.cmd supabase functions deploy redeem-invite --project-ref $ref --no-verify-jwt
    if ($LASTEXITCODE -ne 0) { Write-Host 'STOP: the redeem-invite deploy failed; the push IS done. Send GEO the red lines.' -ForegroundColor Red; return }
    Write-Host "PASS: L-Ai main is $tue and redeem-invite is deployed with --no-verify-jwt. Now open the live /app/ page and sign in once." -ForegroundColor Green
}
