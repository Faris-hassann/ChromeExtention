# Frontend — Files & Clipboard

## Downloads/uploads

A download becomes an ephemeral task file:

```json
{
  "id": "file_001",
  "name": "Employees.xlsx",
  "sourceUrl": "...",
  "status": "downloaded"
}
```

Only task-approved/known files can be offered to `upload_file`.

## Clipboard

Prefer structured task memory over the OS clipboard.

Example:

```text
SharePoint extract -> task memory -> HR fill
```

Expose clipboard as a controlled tool only if a real clipboard workflow is needed.

Never use clipboard access as a shortcut to obtain secrets.
