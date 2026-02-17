# Fantasy Auto Battle

An auto card battler game

## What sets it apart?

1. Card definitions are just plain data
2. Cards can be easily extend via mods or variants
3. Battles are deterministic using a pseudo random number generator

## What does the Tech Stack look like?

| Concern            | Technology                  |
| ------------------ | --------------------------- |
| UI Framework       | React                       |
| Language           | TypeScript                  |
| State Management   | Jestor (in-repo) + Immer    |
| Bundler            | Vite                        |
| Package Manager    | pnpm                        |
| Testing            | Vitest                      |
| E2E Testing        | Playwright                  |
| CI/CD              | GitHub Actions              |
| Deployment         | GitHub Pages                |

## How do I get started?

### Prerequisites

The project uses `tool-tool.exe` to manage Node.js and pnpm versions automatically. No manual Node.js or pnpm installation is required.

### Install Dependencies

```bash
cd ui
../tool-tool.exe pnpm install
```

### Build

```bash
cd ui
../tool-tool.exe pnpm build
```

### Run Tests

```bash
cd ui
../tool-tool.exe pnpm test
```

### Formatting and Checks

```bash
cd ui
../tool-tool.exe pnpm run format
../tool-tool.exe pnpm run check
```


## Documentation

Detailed documentation is available in the `docs/` directory:

- [Documentation Index](docs/DOCUMENTATION.md)
- [Tech Stack](docs/TECH-STACK.md)
- [Testing Strategy](docs/TESTING.md)
