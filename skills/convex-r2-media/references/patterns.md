# Convex + R2 Media Patterns — Concrete Reference

> Extracted from the ToonMagic (Hypermoji) codebase. This file complements the
> abstract guidance in `SKILL.md` with real implementation details.

## Core Module: `convex/lib/media.ts`

This single file is the source of truth for all R2 operations. Every write and
read path flows through it.

### Singleton R2 client

```ts
import { R2 } from "@convex-dev/r2";
import { components } from "../_generated/api";

export const r2 = new R2(components.r2);
```

Registered in `convex/convex.config.ts`:

```ts
import r2 from "@convex-dev/r2/convex.config.js";
const app = defineApp();
app.use(r2);
```

Credentials come from environment variables read by `@convex-dev/r2`:

| Env var | Purpose |
|---|---|
| `R2_BUCKET` | Bucket name |
| `R2_ENDPOINT` | S3-compatible endpoint (`https://<account-id>.r2.cloudflarestorage.com`) |
| `R2_ACCESS_KEY_ID` | R2 API token key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_PUBLIC_BASE_URL` | Public CDN hostname (default: `https://media.hypermoji.com`) |

### Object key format

```
{entity}/{entityId}/{role}/{uuid}.{extension}
```

Built by `buildMediaObjectKey`:

```ts
type MediaKeyParts = {
  entity: "art-styles" | "emotes" | "export-variants" | "mascots";
  entityId: string;
  role:
    | "base" | "export" | "portrait"
    | "raw-base" | "raw-portrait" | "raw-reference"
    | "raw-video" | "reference" | "video";
  extension?: string | null;
};

export function buildMediaObjectKey({ entity, entityId, role, extension }: MediaKeyParts) {
  const safeExtension = (extension || "bin").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `${entity}/${entityId}/${role}/${crypto.randomUUID()}.${safeExtension}`;
}
```

Example keys:
- `emotes/jn7abc123/raw-base/550e8400-e29b-41d4-a716-446655440000.png`
- `mascots/k57def456/base/a1b2c3d4-e5f6-7890-abcd-ef1234567890.webp`
- `export-variants/m89ghi789/export/deadbeef-cafe-babe-dead-beefcafebabe.gif`

The `raw-` prefix marks the version with the original background.
The non-raw counterpart is the transparency-processed version.

### Public URL construction

```ts
const DEFAULT_PUBLIC_MEDIA_BASE_URL = "https://media.hypermoji.com";

function getPublicMediaBaseUrl() {
  return (
    process.env.R2_PUBLIC_BASE_URL ||
    process.env.R2_PUBLIC_URL ||
    DEFAULT_PUBLIC_MEDIA_BASE_URL
  ).replace(/\/+$/, "");
}

export function buildPublicMediaUrl(key: string) {
  const encodedKey = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${getPublicMediaBaseUrl()}/${encodedKey}`;
}
```

Each path segment is percent-encoded individually, so UUIDs pass through
unchanged while unusual characters in entity IDs get encoded.

**Do not use `r2.getUrl()`** for public delivery. It produces signed
`*.r2.cloudflarestorage.com` URLs that expire, break caching, and fail
through Next.js `/_next/image` optimization.

### URL resolution with legacy fallback

```ts
export async function resolveMediaUrl(
  ctx: { storage: { getUrl(id: Id<"_storage">): Promise<string | null> } },
  args: { key?: string | null; storageId?: Id<"_storage"> | null },
) {
  if (args.key) return buildPublicMediaUrl(args.key);         // sync, no network call
  if (args.storageId) return await ctx.storage.getUrl(args.storageId); // async fallback
  return null;
}
```

Every call site passes both fields. The key-first path is synchronous (just
string concatenation), while the storageId fallback requires an async Convex
internal call.

### Upload helper

```ts
export async function storeBlobAsR2Media(
  ctx: Parameters<typeof r2.store>[0],
  blob: Blob,
  keyParts: Omit<MediaKeyParts, "extension"> & {
    extension?: string | null;
    cacheControl?: string;
  },
) {
  const key = buildMediaObjectKey({
    ...keyParts,
    extension: keyParts.extension || extensionFromMimeType(blob.type),
  });

  await r2.store(ctx, blob, {
    key,
    type: blob.type || undefined,
    cacheControl: keyParts.cacheControl ?? "public, max-age=31536000, immutable",
  });

  return { key, url: buildPublicMediaUrl(key) };
}
```

Default cache-control is `public, max-age=31536000, immutable` — full CDN
caching since keys contain UUIDs and are never reused.

### Delete helper

`convex/lib/mediaCleanup.ts`:

```ts
export const deleteMediaObjects = internalAction({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    for (const key of args.keys) {
      try {
        await r2.deleteObject(ctx, key);
      } catch (error) {
        console.error(`[mediaCleanup] Failed to delete R2 object ${key}:`, error);
      }
    }
  },
});
```

Called asynchronously via `ctx.scheduler.runAfter(0, ...)` from deletion
mutations — never blocks the user-facing mutation.

---

## Schema Field Pattern

Every media-bearing table uses parallel `*Key` (R2) and `*StorageId` (legacy)
fields. Both are optional to support dual-write and migration.

### mascots table

| R2 Key Field | Legacy StorageId Field | Description |
|---|---|---|
| `rawBaseImageKey` | `rawBaseImageStorageId` | Original image with background |
| `baseImageKey` | `baseImageStorageId` | Transparent image |
| `rawPortraitBaseImageKey` | `rawPortraitBaseImageStorageId` | Portrait with background |
| `portraitBaseImageKey` | `portraitBaseImageStorageId` | Transparent portrait |

### emotes table

| R2 Key Field | Legacy StorageId Field | Description |
|---|---|---|
| `rawBaseImageKey` | `rawBaseImageStorageId` | Image with background |
| `baseImageKey` | `baseImageStorageId` | Transparent image |
| `rawVideoKey` | `rawVideoStorageId` | Video with background |
| `videoKey` | `videoStorageId` | Transparent video |
| `gifKey` | `gifStorageId` | GIF export |

### artStyles table

| R2 Key Field | Legacy StorageId Field | Description |
|---|---|---|
| `rawReferenceImageKey` | `rawReferenceImageStorageId` | With background |
| `referenceImageKey` | `referenceImageStorageId` | Transparent |

### emoteExportVariants table

| R2 Key Field | Legacy StorageId Field | Description |
|---|---|---|
| `key` | `storageId` | Export variant blob |

---

## Data Layer: Fan-Out URL Resolution

`convex/data/emotes.ts` shows the pattern for resolving all media URLs for a
record. All five fields are resolved in parallel:

```ts
async function getEmoteMediaUrls(ctx, emote) {
  const [rawBaseImageUrl, rawVideoUrl, baseImageUrl, videoUrl, gifUrl] =
    await Promise.all([
      resolveMediaUrl(ctx, { key: emote.rawBaseImageKey, storageId: emote.rawBaseImageStorageId }),
      resolveMediaUrl(ctx, { key: emote.rawVideoKey,     storageId: emote.rawVideoStorageId }),
      resolveMediaUrl(ctx, { key: emote.baseImageKey,    storageId: emote.baseImageStorageId }),
      resolveMediaUrl(ctx, { key: emote.videoKey,        storageId: emote.videoStorageId }),
      resolveMediaUrl(ctx, { key: emote.gifKey,          storageId: emote.gifStorageId }),
    ]);
  return { rawBaseImageUrl, rawVideoUrl, baseImageUrl, videoUrl, gifUrl };
}
```

Every public query (`getEmote`, `getEmotePublic`, `listEmotesForMascot`, etc.)
calls this helper to enrich the record before returning.

---

## Write Path Call Sites

All R2 writes flow through `storeBlobAsR2Media`. Key call sites:

| File | Trigger | Entity | Role |
|---|---|---|---|
| `convex/features/mascotGeneration/generate.ts` | Mascot base image | `mascots` | `raw-base` |
| `convex/features/mascotGeneration/generateVariations.ts` | Variation images | `mascots` | `raw-base` |
| `convex/features/mascotGeneration/generatePortraitVersion.ts` | Portrait crop | `mascots` | `raw-portrait` |
| `convex/features/mascotGeneration/importCharacter.ts` | User upload | `mascots` | `raw-base` |
| `convex/features/emoteGeneration/generateEmoteBase.ts` | Emote base pose | `emotes` | `raw-base` |
| `convex/features/emoteGeneration/generateEmoteVideo.ts` | Raw video | `emotes` | `raw-video` |
| `convex/features/artStyles/generateArtStyle.ts` | Art style reference | `art-styles` | `raw-reference` |
| `convex/lib/hypervideo/hypervideoActions.ts` | Transparency-processed image | varies | `base`/`portrait`/`reference` |
| `convex/lib/hypervideo/hypervideoActions.ts` | Transparency-processed video | `emotes`/`export-variants` | `video`/`export` |
| `convex/features/admin/mutations.ts` | Dev-to-prod import | all | various |
| `convex/migrations/backfillR2MediaKeys.ts` | Legacy backfill | all | all |

---

## Deletion Pattern

When deleting a record (e.g., `deleteEmote` in `convex/data/emotes.ts`):

1. Collect all R2 keys from the record and its child records (export variants).
2. Delete legacy Convex Storage blobs synchronously (`ctx.storage.delete`).
3. Delete the DB record.
4. Schedule async R2 cleanup:

```ts
if (r2KeysToDelete.length > 0) {
  await ctx.scheduler.runAfter(
    0,
    internal.lib.mediaCleanup.deleteMediaObjects,
    { keys: r2KeysToDelete },
  );
}
```

This keeps the mutation fast — R2 deletes happen in a separate action.

---

## Internal Mutations: omitUndefined Pattern

When patching a record with optional key/storageId fields, never patch
`undefined` values into the DB. Use the `omitUndefined` helper:

```ts
function omitUndefined<T extends Record<string, any>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

// Usage in mutation handler:
const { emoteId, ...fields } = args;
await ctx.db.patch(emoteId, {
  ...omitUndefined(fields),
  updatedAt: Date.now(),
});
```

---

## Migration: Backfill from Convex Storage to R2

`convex/migrations/backfillR2MediaKeys.ts` — the main `internalAction`:

1. Queries entities that have a `storageId` but no corresponding `Key` field.
2. Gets the Convex Storage URL via `resolveMediaUrl(ctx, { storageId })`.
3. Fetches the blob via HTTP.
4. Re-uploads via `storeBlobAsR2Media` to R2.
5. Patches the record with the new key via entity-specific patch mutations.

Supports `dryRun` mode (sets `"__dry_run__"` as key, skips upload/patch) and
a `limit` parameter for batch processing.

**Verification query** (`verifyR2MediaBackfill`): returns counts of records
still missing their R2 key for each table, plus an `allClear` boolean.

Orchestrated via `convex/migrations/runR2MediaBackfill.ts` which exports
`migrate` and `verify` as `internalAction` wrappers.

---

## Next.js Configuration

`apps/next/next.config.ts`:

```ts
remotePatterns: [
  { protocol: "https", hostname: "*.convex.cloud" },
  { protocol: "https", hostname: "img.clerk.com" },
  { protocol: "https", hostname: "*.clerk.accounts.dev" },
  { protocol: "https", hostname: "media.hypermoji.com" },
],
```

`media.hypermoji.com` is allowlisted for `<Image>` optimization.

---

## CORS Configuration

No CORS config in the codebase — it's managed in the Cloudflare dashboard.
Recommended policy for this app:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://hypermoji.com",
      "https://www.hypermoji.com"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

All uploads happen server-side from Convex actions — no browser-direct PUT
needed.

---

## Pitfalls Encountered in Production

### 1. Signed URLs through Next.js image optimizer

**Symptom**: Images render as broken or 400 errors.
**Cause**: Backend was emitting `r2.getUrl()` signed URLs with `X-Amz-*`
query params. Next.js proxied these through `/_next/image?url=...` and the
bucket-host domain wasn't in `remotePatterns`.
**Fix**: Switch to `buildPublicMediaUrl(key)` which produces
`https://media.hypermoji.com/{key}` — stable, cacheable, allowlisted.

### 2. Patching `undefined` into optional fields

**Symptom**: Convex throws on patch with `undefined` values.
**Fix**: Use `omitUndefined()` before every `ctx.db.patch` call that takes
optional media fields.

### 3. Backfill scanning the same rows

**Symptom**: Migration batch processes the same already-migrated leading rows.
**Fix**: Use bounded queries that filter on `!key` existence so already-
migrated rows are skipped.

### 4. Missing dependencies in `apps/next/package.json`

**Symptom**: `convex codegen` fails on Vercel with "Could not resolve" errors.
**Cause**: Vercel only installs workspace dependencies, not root `package.json`.
**Fix**: Ensure `@convex-dev/r2`, `@aws-sdk/client-s3`, and all other Convex
backend deps are in both root and `apps/next/package.json`.

---

## Provenance

This skill was initially scaffolded by Codex (skimlinked) and then refined
with concrete patterns extracted from the ToonMagic/Hypermoji codebase by
Claude Code.
