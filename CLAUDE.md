# VLT – notes for Claude

- **Always commit and push directly to `main`.** No feature branches, no pull requests.
  Every push to `main` (except docs-only changes) automatically publishes a new
  release via `.github/workflows/release.yml`, which is how users get updates.
- The release workflow commits a version bump (`Release vX.Y.Z`) back to `main`,
  so always `git pull --rebase origin main` before committing/pushing.
- Never change the vault location (`%APPDATA%\VLT\vault`), the on-disk format
  without a migration in `src/main/vault/vault.js#_migrate`, or
  `nsis.deleteAppDataOnUninstall` (must stay `false`). Updates must never lose user data.
- Run `npm test` before pushing.
- Direct installer download: https://github.com/trendlinepros-afk/VLT/releases/latest/download/VLT-Setup.exe
