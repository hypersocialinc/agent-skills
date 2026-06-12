---
name: ios-testflight-fastlane
description: "Set up fastlane to build a native iOS app and upload it to TestFlight: App Store Connect API-key auth, automatic build numbering stamped across every target's Info.plist, optional XcodeGen regeneration, gym archive/export, and upload_to_testflight. Use when adding TestFlight distribution to a new iOS project, wiring a `fastlane beta` lane, scripting `xcodebuild` archive/upload, or debugging code-signing, build-number, or export-method failures during an iOS release."
---

# iOS TestFlight with fastlane

Wire one-command TestFlight releases into a native iOS project using
[fastlane](https://fastlane.tools). The result: `fastlane beta` (or an optional
`pnpm ios:testflight` alias) archives a Release build, computes the next build
number, signs, exports an IPA, and uploads it to TestFlight — no manual Xcode
archiving and no Apple ID / 2FA prompts.

This skill targets a **single app, TestFlight only** (not App Store review
submission, not CI). It assumes an XcodeGen-based project by default but works
for a committed `.xcodeproj` by deleting one line.

## Artifacts to copy

Three concrete, working files live in `references/` — copy them and change the
marked constants rather than writing from scratch:

- **`references/Fastfile`** → `apps/ios/fastlane/Fastfile`. Two lanes: `beta`
  (build + upload) and `upload` (push an existing IPA). All the hard-won logic
  and gotcha comments are inline.
- **`references/Appfile`** → `apps/ios/fastlane/Appfile`. App id + team id.
- **`references/env.testflight.local.example`** → `<repo-root>/.env.testflight.local`
  (gitignored). Holds the secrets.

`references/setup-and-gotchas.md` is the full guide — read it before running a
release. Load it for App Store Connect API-key creation, signing requirements,
the versioning model, multi-target plist handling, and the gotcha rationale.

## Workflow

1. **Install fastlane via Homebrew**, not `gem install` — macOS system Ruby is
   too old: `brew install fastlane`.
2. **Create an App Store Connect API key** (Users and Access → Integrations →
   App Store Connect API, "App Manager" role). Capture the Key ID, Issuer ID,
   and the one-time `.p8` download. Details in `references/setup-and-gotchas.md`.
3. **Copy the three artifacts** above into place. `apps/ios/` is an example
   layout; if the iOS project lives elsewhere, adjust the `IOS_DIR`/`ROOT_DIR`
   `..` depth at the top of the Fastfile so they resolve to the iOS project dir
   and the repo root (where `.env.testflight.local` lives).
4. **Set the constants** in the Fastfile: `SCHEME`, `BUNDLE_ID`, `TEAM_ID`, and
   `PLISTS` — list one `Info.plist` per shipping target (app + every embedded
   extension). Match `Appfile` to the same bundle id / team id.
5. **Keep or delete the `xcodegen generate` line** — keep for XcodeGen projects,
   delete when the `.xcodeproj` is committed.
6. **Fill `.env.testflight.local`** — required: `ASC_API_KEY_ID`,
   `ASC_API_ISSUER_ID`, `ASC_API_KEY_PATH`, `ASC_APPLE_ID`; optional:
   `TESTFLIGHT_SIGNING_AUTH_MODE` (defaults to the `apple_id` path when unset).
   Add the file to `.gitignore`.
7. **Dry-run, then release:** `fastlane beta skip_upload:true` archives and
   exports an IPA without publishing; once that succeeds, run `fastlane beta`.

## Key facts the agent must not get wrong

- **Build numbering is automatic.** The lane stamps
  `max(latest TestFlight, local plists) + 1` into every listed plist. Never
  hand-edit `CFBundleVersion`; do bump `CFBundleShortVersionString` (marketing
  version) by hand, and keep it identical across all target plists or the lane
  aborts.
- **`ASC_APPLE_ID` is the numeric app id, not an email.** This is the most common
  first-run failure.
- **Signing** uses automatic signing + `-allowProvisioningUpdates`; the Mac needs
  an Apple Distribution certificate (true if it has archived to the App Store
  from Xcode before).
- **`export_method` is `"app-store"`** (legacy alias), and signing `xcargs` must
  be passed to **both** the archive and export steps — both encoded in the
  Fastfile, explained in `references/setup-and-gotchas.md`.

## Portability

Keep the skill project-agnostic. The bundle ids, team id, and `apps/ios/...`
paths in the artifacts are **examples** — every release-specific value belongs in
the copied Fastfile or the gitignored env file, never hardcoded as a requirement.

## Reference files

- **`references/setup-and-gotchas.md`** — prerequisites, ASC API key, signing,
  versioning model, multi-target plists, gotcha rationale, adaptation checklist.
- **`references/Fastfile`** — the working lanes to copy.
- **`references/Appfile`** — app id + team id.
- **`references/env.testflight.local.example`** — secrets template.
