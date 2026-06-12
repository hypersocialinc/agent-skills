# TestFlight + fastlane: setup, versioning, and gotchas

Concrete detail behind `SKILL.md`. The working `Fastfile`, `Appfile`, and
`env.testflight.local.example` in this directory are the artifacts to copy.

## One-time prerequisites

### 1. Install fastlane via Homebrew (not gem)

```bash
brew install fastlane
```

Avoid `gem install fastlane` on macOS: the system Ruby is too old and the
install fails or fights with SIP. Homebrew ships a self-contained Ruby. (If a
project prefers Bundler, a `Gemfile` with `gem "fastlane"` + `bundle install`
also works, and lanes then run as `bundle exec fastlane …`.)

### 2. Create an App Store Connect API key

App Store Connect → **Users and Access** → **Integrations** tab → **App Store
Connect API** → generate a key with the **App Manager** role. This yields three
values for `.env.testflight.local`:

- **Key ID** — shown next to the key (`ASC_API_KEY_ID`).
- **Issuer ID** — UUID at the top of the keys page (`ASC_API_ISSUER_ID`).
- **The `.p8` file** — downloadable **once**; save it and point
  `ASC_API_KEY_PATH` at its absolute path. If lost, revoke and regenerate.

Using an API key (not Apple ID + password) is what makes uploads scriptable and
2FA-free. `upload_to_testflight` and `latest_testflight_build_number` both
authenticate with it.

### 3. Find the numeric app id

App Store Connect → the app → **App Information** → **Apple ID**. This is a
number (e.g. `1234567890`), set as `ASC_APPLE_ID`. It is NOT an email — passing
an email here is the most common first-run mistake. The app record must already
exist in App Store Connect (create it once with the matching bundle id before
the first upload).

### 4. Code signing

The lane passes `-allowProvisioningUpdates` and uses automatic signing, so Xcode
manages the distribution certificate and provisioning profile. Requirements:

- The Apple Developer account is signed into Xcode (Settings → Accounts) and is
  a member of the team whose `TEAM_ID` the Fastfile uses.
- An **Apple Distribution** certificate exists in the login keychain. If the Mac
  has archived to the App Store from Xcode before, this is already true.
- `TESTFLIGHT_SIGNING_AUTH_MODE=api_key` additionally hands the ASC key to
  `xcodebuild` for signing — use it when no interactive Xcode account is present
  (CI). For a developer's own Mac, `apple_id` is simpler.

## Versioning model

Versioning is plist-based and lives entirely in the lane:

- **Marketing version** (`CFBundleShortVersionString`, e.g. `1.2.0`) is set by
  hand in each target's `Info.plist`. The lane reads it and **asserts every
  listed plist matches** — a mismatch aborts before building. Bump it manually
  when cutting a new user-facing version.
- **Build number** (`CFBundleVersion`) is computed:
  `max(latest TestFlight build for this version, highest local plist) + 1`, then
  stamped into every listed plist before archiving. This guarantees a unique,
  monotonic build number and avoids App Store Connect's "build already exists"
  rejection. Override with `build_number:N` (must exceed the local max).

`manageAppVersionAndBuildNumber: false` in the export options stops Xcode from
re-touching versions during export, leaving the lane authoritative.

### Multi-target apps

List **one plist per target that ships in the build** in `PLISTS` — the app plus
every embedded extension (widgets, notification service, notification content,
share/intents extensions). All of them must carry the same marketing version and
get the same build number, or App Store Connect rejects the upload for version
skew between the app and its extensions. A single-target app lists just the one
plist.

## Gotchas (each cost real debugging time)

- **`export_method: "app-store"`, not `"app-store-connect"`.** Older fastlane
  rejects the newer name; `"app-store"` is the legacy alias for the same
  destination and current Xcode still accepts it.
- **xcargs must go to both archive and export.** `gym` does not forward `xcargs`
  to the `-exportArchive` step, so signing args are passed to **both** `xcargs`
  and `export_xcargs`. Omitting `export_xcargs` makes export fail to sign.
- **`Dotenv.load`, not `Dotenv.overload`.** `load` lets already-set shell env
  vars win over the file, so a one-off `ASC_APPLE_ID=… fastlane beta` or CI
  secrets override the local file. `overload` would clobber them.
- **No `apple_id(email)` in `Appfile`.** Providing an email pushes fastlane
  toward Apple ID / 2FA auth even when an API key is configured. Leave it out so
  the API-key path is taken cleanly.
- **`skip_waiting_for_build_processing: true`** returns as soon as the upload
  finishes instead of polling Apple's processing (which can take many minutes).
  **`skip_submission: true`** uploads to TestFlight without pushing to review.
- **XcodeGen projects must be regenerated before archiving.** The lane runs
  `xcodegen generate` first so the `.xcodeproj` reflects `project.yml`. Delete
  that line for projects whose `.xcodeproj` is committed.

## Adapting the Fastfile to a new project

1. Copy `Fastfile`, `Appfile` into `<repo>/apps/ios/fastlane/` (or wherever the
   iOS project lives — fix the `IOS_DIR`/`ROOT_DIR` `..` depth to reach the repo
   root and the `.env.testflight.local`).
2. Set `SCHEME`, `BUNDLE_ID`, `TEAM_ID`, and `PLISTS` (one per target). Match
   `Appfile`'s `app_identifier`/`team_id` to the Fastfile.
3. Keep or delete the `xcodegen generate` line depending on whether the project
   is generated.
4. Copy `env.testflight.local.example` to `<repo-root>/.env.testflight.local`,
   fill it in, and add `.env.testflight.local` to `.gitignore`.
5. Optionally add npm/pnpm script aliases:
   ```json
   "ios:testflight": "cd apps/ios && fastlane beta",
   "ios:testflight:upload": "cd apps/ios && fastlane upload"
   ```
6. Validate without publishing: `fastlane beta skip_upload:true` (archives and
   exports an IPA under `apps/ios/build/testflight/`, no upload). Then drop
   `skip_upload` for the real run.
