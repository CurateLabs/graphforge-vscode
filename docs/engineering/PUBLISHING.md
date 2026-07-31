# Publishing

Scaffold only — not publishing to the Marketplace yet.

## Identity

- Publisher: `CurateLabs`
- Extension name: `graphforge`
- Fully qualified id: `CurateLabs.graphforge`

## When ready

1. Ensure Marketplace publisher `CurateLabs` exists and PAT is configured for `vsce`.
2. Link or depend on a published `@graphforge/node` (or ship install docs for local napi).
3. `npm run package` → `.vsix`
4. `vsce publish` (or CI release job)

See root `README.md` for local F5 development.
