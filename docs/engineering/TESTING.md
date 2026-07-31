# Testing

## Local gates

```bash
npm install
npm run check      # tsc --noEmit
npm run compile    # esbuild extension + tests
npm run test:unit  # FORMAT detector (plain mocha, no Electron)
npm test           # @vscode/test-cli (Extension Development Host)
```

Requires `@vscode/test-electron` ≥ 3.1.0 on macOS (VS Code 1.110+ ships `Code` instead of `Electron`).

## What we prove now

| Area | Test | Notes |
|---|---|---|
| Project detection | `src/test/projectDetector.test.ts` | Exact FORMAT bytes; CURRENT parse |
| Activation | `src/test/extension.test.ts` | Extension id, core commands, `cypher` language |

## Gaps (post-scaffold)

- Integration against a real `@graphforge/node` binary and sample project
- Webview message-protocol contract tests
- Verb QuickPick → IPC round-trip with fixtures

## CI recommendation

Run `npm run check && npm run compile && npm test` on PRs once a headless VS Code test job is wired.
