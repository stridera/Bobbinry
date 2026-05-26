# Import

Import an existing manuscript into Bobbinry. Each uploaded file is parsed
into proposed chapter segments, previewed and edited by the user, then
committed as `content` entities under the manuscript bobbin.

- Server-side parsing in `apps/api/src/lib/import-parsers/`, dispatched by
  `apps/api/src/routes/import.ts` (`POST /import/parse`, `POST /import/commit`).
- Upload pipeline reuses the existing presigned-URL flow with a new
  `'import'` context (`apps/api/src/routes/uploads.ts`).
- Wizard UI lives in
  `apps/shell/src/app/projects/[projectId]/components/dashboard/import/`.

Phase 3 ships `.txt` and `.md`. Later phases extend the parser dispatcher
to add `.docx`, `.epub`, `.pdf`, `.odt`, `.rtf`, and `.html`.
