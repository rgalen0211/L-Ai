# The app download card: words for Ryan's yes (DRAFT, WEB, Sat 2026-11-28)

Every public word below is NEW and is a DRAFT. None is live: the card shows these only for an account the server can serve (see "The door"), and the setup file does not exist yet. Source of items 3 to 8 (the six steps): CONNECT's plan `proposals/CONNECT-INSTALLER-PLAN-1127.md`, section 6, copied verbatim (Ryan 23:43: the page shows the plain "More info, then Run anyway" step with a screenshot; Ryan 23:49: direct download from our own site, UNSIGNED for now). These words are true only while the setup is unsigned.

No price, no credit amount, no "free" claim anywhere on the card.

## The words (11 items; each is marked FOR RYAN'S YES in the code, `assets/app-device.js`)

1. **Not ready yet** (card heading "Ryagram for Windows", and the Compilations page): "The Ryagram app is not ready to download yet." Shown, with no button, to an account whose Compilations switch is on while the setup file is not released (the server door for such an account is live; the FILE is what is missing). Changed 11-28 from "not open for download to your account yet" on BUILDER's news.
2. **Intro** (bold; RENDERER 11-28 rule b: only what Windows does and how to check, no promise about a file nobody outside has scanned; this replaces the plan's section 6 intro): "Windows may warn you before it opens the Ryagram setup, because the file is new and not yet widely downloaded. Check that the file name and size are the ones on this page, then go on."
3. **Step 1**: "Download the setup from this page. Its file name and its SHA-256 are shown next to the button. To check them, open PowerShell in the folder you downloaded to and paste: `Get-FileHash Ryagram-Setup-<version>.exe -Algorithm SHA256`. The 64 characters must match the ones on this page. If they do not, delete the file and do not run it." (the card fills in the real file name when the record is ready)
4. **Step 2**: "When you open it, Windows may show a blue window, "Windows protected your PC". Press **More info**. It then shows the file name and "Publisher: Unknown publisher". If the file name is the one on this page, press **Run anyway**."
5. **Step 3**: "If anyone else, anywhere else, ever asks you to press Run anyway for a different file, say no."
6. **Step 4**: "Windows 11 has a feature called Smart App Control. If it is on, Windows may refuse to open the setup at all and show no Run anyway button. We do not ask you to turn a security feature off. If you see that message, write to us at the address on the Help page and we will help you another way." (The plan's note "DRAFT; Ryan to decide what 'another way' is, see decision 5" is NOT shown on the page; it is still Ryan's to decide.)
7. **Step 5**: "The setup puts Ryagram in a folder you choose (it suggests a D: drive if you have one), adds one Start-menu entry, and adds an entry to Windows' list of installed apps. You can remove it from there at any time; the setup asks whether to keep your films."
8. **Step 6**: "The first time you open Ryagram it shows a short code. You approve the code on uselai.com while signed in there. No password is typed into the app. It then offers to download the listening model (about 464 MB, once)."
10. **What the SHA-256 is for** (RENDERER rule a; under the file facts, never the word signature): "The SHA-256 shows that the file was not damaged on its way to you. It cannot show who made the file, because this same site gives you both."
11. **Updates** (RENDERER rule d; a marked draft sentence after the steps, for CONNECT to confirm against the installer): "Ryagram does not update itself and does not download new program code. To update it, install a newer setup from this page; it upgrades the Ryagram you already have in place."
9. **Compilations page link** (44px): "Get the Ryagram app" (goes to the Ryagram for Windows card on the Account page). Shown only when the account may press the button; otherwise item 1 is shown in its place. (Items are numbered by where they were added; the card shows 10 under the file facts and 11 after the steps.)

Reused unchanged from the existing zip card (not new): the File / Size / SHA-256 labels, "The Ryagram app for your Windows computer. Your films are made on it.", the Chrome and memory line, and "To sign this computer out, press Remove this computer in the "Computers signed in" list just below this card." (the zip card's "To remove it, delete the folder" half is not shown for a setup: step 5 replaces it). The zip card keeps its own four steps and the word "unzip"; a setup card never says it.

## The screenshot

The plan wants a screenshot of the real "Windows protected your PC" window. **There is none.** No picture was made or invented: a screenshot of the real dialog is needed from the stranger's walk (plan section 7). The card has a slot (`WARNING_SHOT`, null) that draws an image with alt text only when a real file's address is put there.

## The door (the BUTTON stays behind a constant)

The card shows for a tester (as today) or for an account whose Compilations switch is on (`featureOn('compilations')`, or `my_departments()` naming Compilations as working). The BUTTON is for a tester, or for a Compilations account once `APP_DOWNLOAD_COMPILATIONS_DOOR` is flipped to true in `assets/app-device.js`.

Server state (BUILDER 11-28): eligibility is ALREADY LIVE (migration 000300, applied 11-27: `request_app_download` also gives the app to an account with Compilations on, keeping tester and admin). What is left on the server: BUILDER's migration `20261128000300_app_setup_exe` (`app_releases.file_name` may end in `.exe`) and CONNECT's release record (an active `Ryagram-Setup-<version>.exe` row, plus `windows-release.js` and the pins naming it). Flip the constant only when that row exists and the node, the connector and this page are all live (RENDERER rule c): until then a Compilations account sees only item 1. In the mock, `?appdoor` turns the door on and serves a made-up setup record.
