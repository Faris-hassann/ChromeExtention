# Workflows — Reusable Workflows

## Storage

No database.

Workflows may be stored as configuration in `chrome.storage.local` and imported/exported as JSON.

## Goal-based, not selector-based

Bad:

```text
click #button-482
click div:nth-child(8)
```

Good:

```text
Find employee in SharePoint.
Extract employee ID, work email and department.
Open HR portal.
Find same employee.
Map fields.
Fill changes.
Ask before submit.
```

## Suggested schema

```json
{
  "name": "Copy SharePoint Employee To HR",
  "version": 1,
  "inputs": ["employeeName"],
  "sites": ["sharepoint", "hr-portal"],
  "goals": [
    "Find employee in SharePoint",
    "Extract requested employee data",
    "Open HR portal",
    "Find employee",
    "Map and fill destination fields",
    "Request approval before submission"
  ]
}
```

## Versioning

Imported workflows must validate version/schema and fail clearly when unsupported.
