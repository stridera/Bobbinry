# Google Drive Backup

Automatically back up all your projects to Google Drive. Each project gets
a subfolder under a configurable root folder; chapters are written as
markdown files and kept in sync as you edit.

- Contributes a `shell.projectBackup` panel for OAuth + sync controls.
- Token refresh and per-project sync state live in the API
  (`apps/api/src/routes/google-drive.ts`).
- Requires Google OAuth client credentials in `GOOGLE_ID` / `GOOGLE_SECRET`.
- The token-refresh helper now throws typed errors so users see
  re-authorization prompts instead of opaque 500s.
