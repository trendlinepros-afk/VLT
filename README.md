# VLT

VLT is an encrypted vault for Windows. You can keep notes, photos, videos and documents in it, and nobody can open them without your master password.

- **One master password.** Everything is encrypted with it.
- **Self-destruct.** If the wrong password (or the wrong MFA code) is entered **10 times in a row**, the vault is permanently destroyed.
- **Two-factor authentication (optional).** Scan a QR code with Google Authenticator, Microsoft Authenticator, Authy or a similar app. You also get 8 one-time recovery codes.
- **Built-in viewer.** Photos, videos, audio, PDFs, Word (.docx) files and text files open inside VLT. They are decrypted in memory and never written to disk.
- **Notes**, with autosave.
- **Check for updates** button. It downloads the newest release from GitHub and installs it. Your vault data is never touched.
- **Auto-lock** after inactivity, and whenever Windows is locked or the PC goes to sleep.
- **Encrypted backups** that you can copy to a USB drive, and restore later.

---

## Installing

1. Download the installer: **[VLT-Setup.exe](https://github.com/trendlinepros-afk/VLT/releases/latest/download/VLT-Setup.exe)** (always the latest version).
2. Run it. Windows SmartScreen may say *"Windows protected your PC"* because the app is not code-signed (see [Code signing](#code-signing-optional)). Click **More info → Run anyway**.
3. Start VLT, choose a strong master password, and you're in.

## Updating

Click **Check for updates** (top-right in the vault, on the lock screen, or in Settings). If a newer version exists on GitHub, VLT:

1. downloads it and checks its SHA-512 checksum,
2. locks the vault and finishes any in-progress writes,
3. installs the update silently and restarts.

### Why updates can't lose your data

- The vault lives in `%APPDATA%\VLT\vault`. The program lives in `%LOCALAPPDATA%\Programs\VLT`. Updates only replace the program folder.
- The uninstaller is set to **never** delete app data (`deleteAppDataOnUninstall: false`).
- Every vault write is atomic (write to a temp file, flush to disk, then rename). A crash or power cut mid-write leaves the previous good copy.
- The item index keeps a previous generation (`index.enc.bak`), which is used automatically if the main copy is damaged.
- The vault file has a format version. If a future version ever changes the format, VLT first backs up the header and index to a `pre-upgrade-backup-…` folder. An older VLT refuses to open a newer vault instead of risking damage to it.

---

## Publishing a new version (for the repo owner)

> ⚠️ **The repository must be public for "Check for updates" to work** (or see the alternative below).
> Installed apps download releases anonymously. GitHub hides releases of private repositories, and putting a GitHub token inside the app would let anyone who has the app read your repo.
> Making the source public does **not** weaken the vault. Its security comes from your password and the encryption, not from hiding the code.
>
> *Alternative:* keep this repo private, create a second **public** repository (e.g. `VLT-releases`), and change `build.publish[0].repo` in `package.json` to point at it. The release workflow then needs a personal access token with `contents: write` on that repo, stored as a secret and used instead of `GITHUB_TOKEN`.

**Every push to `main` publishes a new version automatically.** The Release workflow:

1. runs the tests on Windows,
2. bumps the patch version (1.0.1 → 1.0.2), commits it to `main` and tags it,
3. builds `VLT-Setup.exe` and publishes a GitHub Release with `latest.yml`.

Changes to Markdown files alone don't trigger a release. For a bigger version jump, use **Actions → Release → Run workflow** and choose `minor` or `major`. Because the workflow commits the version bump back to `main`, run `git pull` before your next push.

Every installed copy of VLT then sees the update when you click **Check for updates**.

## Developing

```bash
npm install
npm start          # run the app (uses your real %APPDATA%\VLT\vault)
npm test           # vault/crypto unit tests
npm run dist       # build the installer locally into dist/ (Windows)
```

During development, set `VLT_DEV_DATA_DIR=C:\some\test\folder` to use a throwaway vault. This variable is ignored in the installed app.

Layout:

| Path | What it is |
| --- | --- |
| `src/main/vault/` | Vault engine: crypto, storage format, MFA (no Electron dependency, fully unit-tested) |
| `src/main/main.js` | Electron main process: window hardening, IPC, encrypted media streaming, auto-lock |
| `src/main/updater.js` | GitHub update check, download and install |
| `src/preload/preload.js` | The narrow API the UI is allowed to call |
| `src/renderer/` | The user interface |
| `.github/workflows/` | CI tests and the release pipeline |

---

## Security design

| | |
| --- | --- |
| Password → key | **Argon2id**, 128 MiB memory, 3 passes, random 16-byte salt. Each guess costs an attacker ~1 s and 128 MiB of RAM, so GPU cracking farms are slow. |
| Master key | Random 256-bit key, stored only *wrapped* (encrypted) by the password-derived key. Changing your password re-wraps this key; your files are not re-encrypted. |
| Encryption | **AES-256-GCM** (authenticated). Any tampering with the vault files is detected and rejected. |
| Files | Split into 512 KiB chunks. Each chunk is encrypted with a per-file key (HKDF from the master key). Chunks are bound to their position and to the file, so they can't be reordered, swapped or truncated. This is what lets videos stream and seek without ever writing decrypted data to disk. |
| Metadata | File names, types, sizes, dates and note text are all encrypted. On disk the vault is a set of random-named `.bin` files. |
| Viewer | The UI runs in a sandboxed, context-isolated renderer with a strict Content-Security-Policy and an **in-memory** browser session (no disk cache). All internet access from the vault window is blocked. Decrypted content is served through a private `vlt://` protocol whose access token changes on every unlock. |
| Screen capture | The window is excluded from screenshots, screen recording and screen sharing. |
| App integrity | Electron fuses: no `RUN_AS_NODE`, no `NODE_OPTIONS`, no debugger flags, ASAR integrity validation. |
| Self-destruct | Every attempt is recorded *before* it is checked, so killing the app mid-check doesn't skip the count. On the 10th failure the header, index and key material are overwritten with random data and the vault is deleted. Without the wrapped key the remaining encrypted chunks can't be decrypted. |

### What you should know (honest limits)

- **Your password is the real protection.** The 10-attempt self-destruct protects against someone guessing in the VLT app. A skilled attacker who copies the vault folder off your disk *first* can try passwords offline without that limit, and is only slowed down by Argon2id. **Use a long password**, e.g. 4–5 random words or 14+ characters. With a strong password, offline cracking is infeasible.
- **MFA** stops someone who learns your password from opening the vault in the app. A local app with no server can't make an authenticator code part of the encryption key, so MFA does not add protection against the offline attack above. Your password still does that.
- **Forgotten password = lost data.** There is no back door, by design. If you use MFA, keep the recovery codes safe.
- **Originals.** Adding a file *copies* it into the vault. Delete the original yourself if you only want the vault copy. Note that a normal delete on Windows can sometimes be recovered with forensic tools.
- **"Open in app" / "Export"** create a normal, unencrypted copy (VLT warns you first). "Open in app" copies go to a temp folder that is overwritten and deleted when you lock or close VLT.
- **Backups** you make are still encrypted with your password, but they are **not** destroyed by the self-destruct.
- **A compromised PC** (malware, keylogger) can capture your password while you type it. No vault app can fully protect against that.

### Code signing (optional)

Unsigned installers show a SmartScreen warning. To remove it, buy a Windows code-signing certificate, add it to the repo secrets as `CSC_LINK` (base64 .pfx) and `CSC_KEY_PASSWORD`, and pass them as `env` to the build step in `.github/workflows/release.yml`. electron-builder signs automatically. Signed builds also let the updater verify the publisher of each update.
