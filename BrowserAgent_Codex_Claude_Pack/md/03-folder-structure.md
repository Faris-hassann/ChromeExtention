# Required Implementation Folder Structure

The coding agent may refine filenames, but preserve these boundaries.

```text
project-root/
├── md/                       # this specification pack
├── contracts/                # typed build contracts/reference types
├── tests/                    # executable contract tests
│
├── frontend/
│   ├── package.json
│   ├── vite.config.*
│   ├── tsconfig*.json
│   ├── public/
│   │   └── manifest.json
│   └── src/
│       ├── sidepanel/
│       ├── background/
│       ├── content/
│       ├── browser/
│       ├── observation/
│       ├── permissions/
│       ├── transport/
│       ├── storage/
│       ├── components/
│       └── shared/
│
└── backend/
    ├── package.json
    ├── .env.example
    └── src/
        ├── server/
        ├── transport/
        ├── agent/
        ├── browser/
        ├── tools/
        ├── llm/
        ├── permissions/
        ├── workflows/
        ├── logging/
        └── shared/
```

## No persistence layer

Do not create:

```text
prisma/
database/
repositories for chat/task history
Postgres/Mongo/SQLite services
```

Ephemeral state lives in memory. Minimal extension settings live in `chrome.storage.local`.
