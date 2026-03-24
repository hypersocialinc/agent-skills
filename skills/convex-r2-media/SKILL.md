---
name: convex-r2-media
description: Use when setting up R2-backed images/videos with Convex, adding custom media domains, designing schema patterns for media keys, backfilling from Convex storage to R2, or debugging signed-URL vs public-CDN issues in Next.js image delivery. Also use when encountering broken images with X-Amz query params or r2.cloudflarestorage.com hostnames.
---

# Convex R2 Media

## Overview

**Core principle:** Convex owns metadata. R2 owns binaries. A custom domain serves public media. Never expose signed bucket-host URLs to users.

This skill covers implementation, migration, and review — not just architecture.

## When to Use

- Setting up R2 storage alongside a Convex backend
- Adding a custom domain (e.g. `media.example.com`) for public media delivery
- Designing `*Key` / `*StorageId` schema fields for media-bearing records
- Migrating existing Convex Storage assets to R2
- Debugging broken images that show `*.r2.cloudflarestorage.com` or `X-Amz-*` params
- Reviewing PRs that touch media upload, read, or delete paths

**When NOT to use:**
- Private/temporary files that don't need public URLs (use Convex Storage directly)
- Non-Convex backends

## Critical Rule

Do not use signed `r2.getUrl()` URLs for user-facing image/video delivery.

Why:
- They produce bucket-host URLs like `*.r2.cloudflarestorage.com`
- They expire and break caching
- They fail through Next.js `/_next/image` optimization (400 errors)

Instead: store the object key, serve `https://media.example.com/<encoded-key>`.

## Quick Reference

| Operation | Function | Location |
|---|---|---|
| Build object key | `buildMediaObjectKey({ entity, entityId, role })` | `convex/lib/media.ts` |
| Build public URL | `buildPublicMediaUrl(key)` | `convex/lib/media.ts` |
| Resolve URL (key-first, storageId fallback) | `resolveMediaUrl(ctx, { key, storageId })` | `convex/lib/media.ts` |
| Upload blob to R2 | `storeBlobAsR2Media(ctx, blob, keyParts)` | `convex/lib/media.ts` |
| Delete R2 objects async | `deleteMediaObjects({ keys })` | `convex/lib/mediaCleanup.ts` |
| R2 singleton | `r2` (via `@convex-dev/r2`) | `convex/lib/media.ts` |

## Key Patterns

### Object key format

```
{entity}/{entityId}/{role}/{uuid}.{extension}
```

Entities: `art-styles`, `emotes`, `export-variants`, `mascots`
Roles: `base`, `raw-base`, `portrait`, `raw-portrait`, `reference`, `raw-reference`, `video`, `raw-video`, `export`
The `raw-` prefix = original with background. Non-raw = transparency-processed.

### URL resolution (the central pattern)

```ts
// Key-first: synchronous string build, no network call
if (args.key) return buildPublicMediaUrl(args.key);
// Legacy fallback: async Convex internal call
if (args.storageId) return await ctx.storage.getUrl(args.storageId);
return null;
```

### Public URL construction

```ts
export function buildPublicMediaUrl(key: string) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${getPublicMediaBaseUrl()}/${encodedKey}`;
}
```

Each segment percent-encoded individually. Base URL defaults to `https://media.hypermoji.com` if `R2_PUBLIC_BASE_URL` env var is not set.

### Upload helper

```ts
const { key, url } = await storeBlobAsR2Media(ctx, blob, {
  entity: "emotes",
  entityId: emoteId,
  role: "raw-base",
});
// Returns { key, url } — persist the key, use the url for immediate display
```

Cache-control: `public, max-age=31536000, immutable` (keys contain UUIDs, never reused).

### Schema field pattern

Every media-bearing record uses parallel optional fields:

```ts
// R2 (new path)              // Convex Storage (legacy path)
rawBaseImageKey?: string      rawBaseImageStorageId?: Id<"_storage">
baseImageKey?: string         baseImageStorageId?: Id<"_storage">
videoKey?: string             videoStorageId?: Id<"_storage">
```

### Fan-out URL resolution in queries

```ts
const [rawBaseImageUrl, baseImageUrl, videoUrl] = await Promise.all([
  resolveMediaUrl(ctx, { key: emote.rawBaseImageKey, storageId: emote.rawBaseImageStorageId }),
  resolveMediaUrl(ctx, { key: emote.baseImageKey,    storageId: emote.baseImageStorageId }),
  resolveMediaUrl(ctx, { key: emote.videoKey,         storageId: emote.videoStorageId }),
]);
```

### Async deletion

```ts
// Collect keys during mutation, schedule cleanup after
if (r2KeysToDelete.length > 0) {
  await ctx.scheduler.runAfter(0, internal.lib.mediaCleanup.deleteMediaObjects, { keys: r2KeysToDelete });
}
```

### omitUndefined for patches

Never patch `undefined` into optional fields:

```ts
function omitUndefined<T extends Record<string, any>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
await ctx.db.patch(id, { ...omitUndefined(fields), updatedAt: Date.now() });
```

## Implementation Workflow

1. **Decide storage boundary.** Persisted user-visible media belongs in R2.
2. **Add key fields to schema.** Parallel `*Key` + `*StorageId` fields, both optional.
3. **Add shared media helper.** One module: key builder, URL builder, resolver, uploader, deleter.
4. **Update write paths.** All generation/import flows call `storeBlobAsR2Media` and persist keys.
5. **Update read/query paths.** All queries use `resolveMediaUrl` (key-first, storageId fallback).
6. **Backfill legacy records.** Batch-copy from Convex Storage to R2, patch key fields.
7. **Cut over.** Verify with count query, then remove legacy fallback.

## Environment Variables

| Variable | Purpose |
|---|---|
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` | S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` | API token key ID |
| `R2_SECRET_ACCESS_KEY` | API token secret |
| `R2_PUBLIC_BASE_URL` | Public CDN hostname override |

## Cloudflare / R2 Checklist

- Bucket created
- Custom domain attached and active
- `r2.dev` subdomain NOT used for production
- GET/HEAD CORS configured for app origins
- R2 credentials set in Convex env
- `R2_PUBLIC_BASE_URL` set if not using default

## Next.js Guardrails

- Add public media hostname to `next.config.ts` `remotePatterns`
- If images break via `/_next/image?url=...`, inspect the `url=` param — if it contains `r2.cloudflarestorage.com` or `X-Amz-*`, the backend is emitting signed URLs

## Migration Guardrails

- Backfill in batches with a `limit` parameter
- Never patch `undefined` into optional fields — use `omitUndefined`
- Filter on `!key` existence so already-migrated rows are skipped
- Verify with a query that counts remaining `storageId && !key` cases

## Common Mistakes

| Mistake | Fix |
|---|---|
| Using `r2.getUrl()` for public delivery | Use `buildPublicMediaUrl(key)` |
| Storing URLs instead of keys | Store the R2 object key, derive URLs at read time |
| Patching `undefined` into optional fields | Use `omitUndefined()` before `ctx.db.patch` |
| Missing deps in workspace `package.json` | Ensure `@convex-dev/r2` etc. in both root and `apps/next/package.json` for Vercel |
| Backfill scanning same migrated rows | Use bounded queries that filter on missing key |
| No `media.example.com` in `remotePatterns` | Add to Next.js config or images break through optimizer |

## References

For concrete field tables, all write-path call sites, deletion patterns, and production pitfalls: `./references/patterns.md`

## Provenance

Initially scaffolded by Codex (skimlinked). Refined with concrete patterns from the ToonMagic/Hypermoji codebase by Claude Code.
