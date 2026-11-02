# Releasing

**A push to `main` reaches nobody.** A published release is what reaches Demo Builder's users, who are
offered it on their next update check. Merge freely; release deliberately.

Every component is on Demo Builder's beta track until the extension reaches 1.x, so a version looks
like `1.0.0-beta.3`. A normal version is refused until then.

## To release

1. Set the version in `package.json` and push it. Wait for the `checks` job to pass.
2. From a checkout of `demo-builder-vscode`, run the release step. It only checks until you add `--publish`:

   ```bash
   node .claude/skills/component-release/release.mjs <path-to-this-repo> --version 1.0.0-beta.3 --notes notes.md
   node .claude/skills/component-release/release.mjs <path-to-this-repo> --version 1.0.0-beta.3 --notes notes.md --publish
   ```

Publish only when the owner has said to, for that release. Do not run `gh release create` by hand: the
step refuses a version that is not above the last, a `package.json` that disagrees, empty notes, an
unpushed commit and a `checks` job that has not passed.

To try one first, publish `-alpha.N`. Only a collaborator on Demo Builder's early-access channel is
offered it. An alpha need not change `package.json`.

## CI

Keep the CI job named `checks`, running on every push and pull request and validating the `package.json`
version. Nothing else in this repository may publish a release. `npm run components:ci` in
`demo-builder-vscode` checks this daily.
