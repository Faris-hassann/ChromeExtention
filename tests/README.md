# Executable Test Contracts

These `.spec.ts` files are intentionally executable Jest/Vitest-style contracts that fail until the coding agent wires them to the real implementation.

They are not placeholders to delete.

The coding agent must:

1. Read the corresponding specification MD files.
2. Inspect the implementation's established test framework.
3. Adapt imports/setup/factories to the real frontend/backend.
4. Replace each `contract()` failure with a real assertion.
5. Never skip/delete/convert required cases to `todo` merely to obtain green tests.
6. Run targeted tests until green.
7. Run the full suite.
8. Only then report the requested feature/project FINISHED.

The most important invariant is explicitly tested: **no second meaningful browser action before a fresh observation after the previous meaningful action.**
