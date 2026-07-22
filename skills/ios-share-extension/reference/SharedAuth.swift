import Foundation

/// Constants that let the app and the Share Extension share ONE Clerk session via a
/// keychain access group. Both targets MUST configure Clerk with the *same* `service`
/// and `accessGroup` — Clerk's keychain `service` otherwise defaults to the bundle id,
/// which differs between the app (com.example.myapp) and the extension
/// (com.example.myapp.ShareExtension), so the extension would see a signed-out user.
///
/// This file belongs in a `Shared/` folder compiled into BOTH targets.
enum SharedAuth {
    /// Pinned (NOT the per-target bundle id) so both processes read the same items.
    static let keychainService = "com.example.myapp"

    /// Full access group: team prefix + a group id both targets list in their
    /// `keychain-access-groups` entitlement. At runtime this must be the literal
    /// `TEAMID.<id>`; the entitlement itself may use `$(AppIdentifierPrefix)<id>`.
    /// Replace TEAMID with your Apple Developer Team ID.
    static let keychainAccessGroup = "TEAMID.com.example.myapp"
}
