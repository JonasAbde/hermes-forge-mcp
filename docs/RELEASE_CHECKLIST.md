# forge-mcp — npm Release Checklist

> This document tracks everything required before publishing `forge-mcp` to npm.

## Pre-Release Checklist

### 1. Version Bump

- [ ] Decide version: major/minor/patch (see `CHANGELOG.md` for unreleased changes)
  - Current: `2.0.0`
- [ ] Update `version` field in `package.json`
- [ ] Update `CHANGELOG.md` — move Unreleased to the new version
- [ ] Commit: `chore(release): bump version to X.Y.Z`

```bash
npm version X.Y.Z --no-git-tag-version
git add package.json CHANGELOG.md
git commit -m "chore(release): bump version to X.Y.Z"
```

### 2. Prepublish Tests

- [ ] Run full test suite: `npm test`
- [ ] Run type check: `npm run build`
- [ ] Run lint: `npm run lint`
- [ ] Run format check: `npm run format`
- [ ] Verify `prepare` script runs `build` automatically

### 3. Smoke Test — All Transports

Test both transport modes:

```bash
# HTTP+SSE transport
npm start                        # Start in background
# Verify: curl -X POST http://localhost:3000/mcp \
#   -H "Content-Type: application/json" \
#   -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# Stdio transport
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | node build/index.js
```

### 4. Build Verification

- [ ] `npm run build` — exit code 0, no errors
- [ ] `build/` directory contains all compiled `.js` + `.d.ts` files matching `src/`
- [ ] Verify `build/http-server.js` and `build/index.js` are executable
- [ ] Verify published file list matches `package.json` `"files"` field:
  ```json
  ["build/", "README.md", "LICENSE", "package.json"]
  ```

### 5. npm Publish Access

- [ ] Registry access confirmed: `npm whoami`
- [ ] Package name correct: `forge-mcp`
- [ ] Published package visibility: `npm publish --access public`
- [ ] Verify GitHub npm registry token is configured in repo secrets (`NPM_TOKEN`)

```bash
npm whoami
# Should return your npm username
```

### 6. `package.json` Integrity Check

- [ ] `name` is correct (`forge-mcp`)
- [ ] `main` points to `build/http-server.js`
- [ ] `types` points to `build/http-server.d.ts`
- [ ] `files` array includes `build/`, `README.md`, `LICENSE`, `package.json`
- [ ] `engines.node` is correct (`>=18`)
- [ ] `publishConfig.access` is `public`
- [ ] Dependencies are production-only (no devDeps in published package)
- [ ] All `dependencies` are actually used in production code

### 7. Documentation

- [ ] `README.md` is accurate and up to date
- [ ] `ARCHITECTURE.md` reflects current architecture
- [ ] `CHANGELOG.md` has the release entry
- [ ] `DEPLOY.md` has current deployment steps

## Release Procedure

```bash
# 1. On main branch
git checkout main
git pull origin main

# 2. Run final checks
npm run build
npm test
npm run lint
npm run format

# 3. Publish
npm publish --access public

# 4. Tag release
git tag -a vX.Y.Z -m "forge-mcp vX.Y.Z"
git push origin vX.Y.Z

# 5. Create GitHub Release
# gh release create vX.Y.Z --title "forge-mcp vX.Y.Z" --notes "See CHANGELOG.md"
```

## CI/CD Publishing

The `.github/workflows/publish.yml` workflow handles automated publishing:
- Trigger: push of a version tag (`v*`)
- Builds, tests, publishes to npm
- Creates GitHub Release

Make sure the `NPM_TOKEN` secret is configured in the repository.

## Rollback

### If npm publish fails after partial upload:

```bash
npm unpublish forge-mcp@X.Y.Z --force
```

### If bugs found post-release:

```bash
# Option A: Patch
# Fix bug, bump to X.Y.Z+1, publish

# Option B: Deprecate
npm deprecate forge-mcp@X.Y.Z "contains bug — use X.Y.Z+1 instead"
```

### If package breaks for users:

```bash
# Users can install previous version
npm install forge-mcp@1.0.0
```
