# Installing the SDK in other projects

The SDK packages are private. They are published to **GitHub Packages** (`npm.pkg.github.com`), not to the public npm registry, so only people and machines with access to the Incantly organization can install them. It is the ordinary `npm install`; npm is only told where `@incantly` packages live and given a token.

| Package | What it is |
| --- | --- |
| `@incantly/core` | The scene runtime, renderer, sandbox, validator and probe (`./scenes`, `./testing`) |
| `@incantly/tiptap` | The TipTap figure node, its node view and the live-figure scheduler |
| `@incantly/generation` | The generation service and pipeline; `./client` is the learner device side; `incantly-serve` runs the service |

## Publishing a version

1. Set the same `version` in `packages/core`, `packages/tiptap` and `packages/generation` `package.json`.
2. Commit, then push a matching tag: `git tag v0.1.0 && git push origin v0.1.0`.

The [release workflow](../.github/workflows/release.yml) runs the checks, builds each package with `npm run release` into `.release/<package>` (ESM JavaScript in `dist/` with `.d.ts` types; `@incantly/*` dependencies pinned to the same version) and publishes them with the workflow's own `GITHUB_TOKEN`. A prerelease version such as `0.1.0-dev` is published under the `next` tag, so install it as `@incantly/core@next` or by its exact version.

To build locally without publishing: `npm run release`, then look in `.release/`.

## Installing in a project

Every project that installs the SDK needs two things.

**1. A `.npmrc` beside its `package.json`, committed:**

```
@incantly:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_PACKAGES_TOKEN}
```

The first line sends only `@incantly` packages to GitHub; everything else still comes from the public registry. The second reads the token from an environment variable, so no secret is committed.

**2. A token in `GITHUB_PACKAGES_TOKEN`.** On GitHub: Settings → Developer settings → Personal access tokens → **Tokens (classic)** → scope `read:packages` only. The token's account must be a member of the Incantly organization (or be given read access to the packages). Fine-grained tokens do not work with GitHub Packages' npm registry yet.

Then, as usual:

```
npm install @incantly/core @incantly/tiptap
npm install @incantly/generation   # where the generation service runs
```

`package-lock.json` records the GitHub URLs, so later `npm ci` runs need the same `.npmrc` and token.

## Installing when deploying

Wherever the project is built, give the build the same token as the environment variable `GITHUB_PACKAGES_TOKEN`; the committed `.npmrc` does the rest. Use a dedicated `read:packages` token (from a machine or bot account in the organization) rather than a person's.

| Where | How to provide the token |
| --- | --- |
| **Cloudflare Pages** | Project → Settings → Variables and Secrets → add `GITHUB_PACKAGES_TOKEN` as a secret for Production and Preview builds |
| **Cloudflare Workers** (Workers Builds) | Worker → Settings → Build → Variables and secrets → add `GITHUB_PACKAGES_TOKEN`. Deploying from your machine or CI with `wrangler deploy` instead installs there, so set it there |
| **Vercel / Netlify / Render / Railway** | Project environment variables: `GITHUB_PACKAGES_TOKEN`, available at build time |
| **GitHub Actions** in an Incantly repository | `env: GITHUB_PACKAGES_TOKEN: ${{ secrets.GITHUB_TOKEN }}` with `permissions: packages: read`; in another organization's repository use a repository secret holding the token |
| **A VPS** | `export GITHUB_PACKAGES_TOKEN=…` in the shell or service environment that runs `npm ci` |
| **Docker** | Pass it as a build secret so it never lands in an image layer (below) |

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=secret,id=gh,env=GITHUB_PACKAGES_TOKEN npm ci --omit=dev
COPY . .
CMD ["npx", "incantly-serve"]
```

```
docker build --secret id=gh,env=GITHUB_PACKAGES_TOKEN -t my-app .
```

The token is only needed to **install**. The running site or service never uses it, so do not expose it to the browser or bind it into a Worker at run time.

## Running the generation service from the package

`@incantly/generation` ships the service as the `incantly-serve` command, configured by the environment variables listed in [`serve.ts`](../packages/generation/src/cli/serve.ts) (`ANTHROPIC_API_KEY`, `INCANTLY_TOKEN_SECRET`, `INCANTLY_ALLOWED_ORIGINS`, `PORT`, …):

```
npx incantly-serve
```

It needs Node 20 or later and a writable disk for `INCANTLY_RECORDS_DIR` and `INCANTLY_GALLERY_DIR`, so run it on a VPS, in a container, or on a Node host. The browser packages (`@incantly/core`, `@incantly/tiptap`, `@incantly/generation/client`) bundle into any site, Cloudflare Pages included.
