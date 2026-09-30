# Releasing

Nothing here has been run. The package is unpublished and untagged, and the GitHub
repository does not exist yet. CI gates; it never publishes. Publishing is done by
hand by the owner of the `@hollis-labs` scope, and the tag is created only after the
publish has succeeded and been checked, so a tag never names a version that was not
published.

1. Create the repository (maintainer): `gh repo create hollis-labs/plugin-host-runtime --public --source . --remote origin` then `git push -u origin main`.
2. Confirm CI is green on the commit you will release: both `gate` and `browser-matrix`.
3. In `CHANGELOG.md`, change `## Unreleased` to `## 0.1.0 — <date>` (em dash) and commit it.
4. `npm ci && npm test && npm pack --dry-run`. The file list is `dist/*`, `README.md`, `CHANGELOG.md`, `LICENSE` and `package.json`, with no `.map` files. Confirm `package.json` has no `file:`, `link:` or `workspace:` dependency.
5. Publish, logged in as the scope owner: `npm publish --access public`.
6. Verify the publish before tagging:
   - `npm view @hollis-labs/plugin-host-runtime version` prints `0.1.0`.
   - In an EMPTY temporary directory, `npm install @hollis-labs/plugin-host-runtime@0.1.0`, then import all four entry points (`.`, `/vite`, `/build`, `/browser`) from a small script.
7. Only after step 6 passes: `git tag -a v0.1.0 <sha>`, push the tag, then `gh release create v0.1.0 --notes-file <the CHANGELOG section>`.
8. Once `@hollis-labs/plugin-registry` 0.1.0 is on npm, check that CI's registry step (which packs it from the registry) starts running the registry integration.
