# Contributing to Fantasy auto battle

## Prerequisites

No manual Node.js or pnpm installation is needed. The project uses `tool-tool.exe` to automatically manage toolchain versions.

## Development Setup

```bash
cd ui
../tool-tool.exe pnpm install
```

The dev server should already be running. **Do not start it manually.**

## Development Workflow

1. Create a feature branch from `master`
2. Implement your changes following the project conventions below
3. Run formatting and checks before committing
4. Commit using Conventional Commits format
5. Open a pull request against `master`

## Code Conventions

### Language

- **Developer documentation** (code comments, commit messages, docs) must be in English

### File Naming

- Use descriptive file names -- avoid generic names like `index.ts` or `types.ts`
- Do not use barrel exports (`export * from 'submodule'`)

### Documentation in Code

Use hyperlit comment markers to document the **"Why"**, not the "What". Format as markdown with a question heading:

```typescript
/* 📖 # Why use hash-based routing?
Hash routing works in environments where server-side rewrites
to index.html may not be available.
*/
```

## Testing

Tests are colocated with the source code (same file). See [docs/TESTING.md](docs/TESTING.md) for the full testing strategy.

Guidelines:
- Prefer **black-box testing** -- avoid mocking where possible
- Prefer **data-driven tests** to reduce duplication
- Use **snapshot tests** where appropriate
- Always run tests after completing a feature

### Running Tests

```bash
cd ui
../tool-tool.exe pnpm test                        # All tests
../tool-tool.exe pnpm test path/to/test.spec.ts   # Single file
../tool-tool.exe pnpm run test:e2e                 # E2E tests
```

## Formatting and Checks

Run both commands before committing:

```bash
cd ui
../tool-tool.exe pnpm run format    # Auto-format with Prettier
../tool-tool.exe pnpm run check     # TypeScript, Prettier, ESLint, and tests
```

The pre-commit hook automatically runs ESLint, Prettier, and TypeScript checks.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
feat(UI): Add about button to see version and build date
fix(assessment): Correct grade rounding for edge cases
refactor(test): Extract inline Vitest suites
docs: Update README with new setup instructions
```

Common prefixes: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`

## Pull Requests

- Keep PRs focused on a single concern
- Ensure all CI checks pass (TypeScript, ESLint, Prettier, tests, build)
- Include a clear description of what changed and why
