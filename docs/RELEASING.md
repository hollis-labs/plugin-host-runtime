# Releasing

Nothing here has been run. The package is unpublished and untagged, and the GitHub
repository does not exist yet.

1. Create the repository (maintainer): `gh repo create hollis-labs/plugin-host-runtime --public --source . --remote origin` then `git push -u origin main`.
2. In CI, confirm both jobs are green: `gate` and `browser-matrix`.
3. Move the `## Unreleased` heading in `CHANGELOG.md` to `## 0.1.0 - <date>` **before** tagging, and commit it.
4. `npm pack --dry-run` and confirm the file list is only `dist`, `README.md`, `CHANGELOG.md`, `LICENSE`, `package.json`.
5. Confirm `package.json` has no `file:`, `link:` or `workspace:` dependency.
6. Tag `v0.1.0` and push the tag.
7. Publish (scope owner only): `npm publish --access public`.
8. Create the GitHub Release from the tag using the CHANGELOG section as its notes.
9. Once `@hollis-labs/plugin-registry` 0.1.0 is on npm, CI's registry step (which packs it from the registry) starts running the registry integration; check that it does.
