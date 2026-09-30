# Backend — Ephemeral Working Memory

## Purpose

Carry structured values across browser steps/tabs/sites without relying on chat prose or system clipboard.

## Example

```json
{
  "employee": {
    "name": {"value": "Ahmed Hassan", "source": "SharePoint"},
    "employeeId": {"value": "1052", "source": "SharePoint"},
    "email": {"value": "ahmed@example.com", "source": "SharePoint"},
    "department": {"value": "Finance", "source": "SharePoint"}
  }
}
```

## Rules

- task scoped
- in-memory only
- sanitized from logs
- destroyed when task/session ends
- never written to a database/history store
- values may keep source/provenance metadata for mapping and review
