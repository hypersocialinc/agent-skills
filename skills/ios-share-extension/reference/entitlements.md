# Entitlements — required on BOTH targets

The App Group and keychain-access-group must be declared on **both** the app and the
extension, with **identical** identifiers. This is the single most common failure point:
if either is missing or mismatched, the extension sees a signed-out user (keychain) or
an empty save-queue (App Group).

## Extension: `ShareExtension/ShareExtension.entitlements`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.com.example.myapp</string>
	</array>
	<key>keychain-access-groups</key>
	<array>
		<string>$(AppIdentifierPrefix)com.example.myapp</string>
	</array>
</dict>
</plist>
```

## App: add the same two keys to `MyApp/MyApp.entitlements`

```xml
	<key>com.apple.security.application-groups</key>
	<array>
		<string>group.com.example.myapp</string>
	</array>
	<key>keychain-access-groups</key>
	<array>
		<string>$(AppIdentifierPrefix)com.example.myapp</string>
	</array>
```

## Notes

- `$(AppIdentifierPrefix)` expands to your Team ID + a dot at build time. In Swift you
  need the **literal** `TEAMID.com.example.myapp` for Clerk's `accessGroup` (see
  `SharedAuth.swift`) — the entitlement can use the `$(AppIdentifierPrefix)` variable, but
  the runtime string cannot.
- Both capabilities (App Groups, Keychain Sharing) must also be enabled on the App IDs in
  the Apple Developer portal and reflected in the provisioning profiles, or signing fails.
- The App Group id (`group.…`) and the keychain group id do not have to match each other;
  they just each have to match across the two targets.
