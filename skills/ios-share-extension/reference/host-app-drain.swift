// Host-app side: two edits so the app (a) shares its Clerk session with the extension and
// (b) drains anything the extension queued while offline.

// ============================================================================
// 1) App entry — pin Clerk's keychain, drain the queue when the app activates.
// ============================================================================

import ClerkKit
import SwiftUI

@main
struct MyApp: App {
    private let clerk: Clerk
    @State private var store: FeedStore
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // configure() must run before any access to Clerk.shared. The shared keychain
        // (service + access group) lets the Share Extension reuse this same session to
        // save directly.
        //
        // NOTE: pinning service/accessGroup MOVES where the session is stored, so an
        // already-signed-in user re-signs-in ONCE after this change ships. Expected.
        clerk = Clerk.configure(
            publishableKey: Config.clerkPublishableKey,
            options: .init(keychainConfig: .init(
                service: SharedAuth.keychainService,
                accessGroup: SharedAuth.keychainAccessGroup
            ))
        )
        // ... build your Convex client + store as usual ...
        _store = State(initialValue: FeedStore(/* ... */))
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                // Saves queued by the Share Extension are picked up whenever the app
                // becomes active (including this launch).
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active { store.drainPendingShares() }
                }
        }
    }
}

// ============================================================================
// 2) Store — drain the App Group queue through the NORMAL save path.
// ============================================================================

extension FeedStore {
    /// Drain anything the Share Extension queued in the App Group and save it via the
    /// normal authenticated path. Items that fail (e.g. not signed in yet) stay queued
    /// and retry next activation, so a share is never lost.
    func drainPendingShares() {
        let pending = SharedInbox.all()
        guard !pending.isEmpty, client != nil else { return }
        Task { @MainActor in
            var saved: Set<UUID> = []
            for share in pending {
                do {
                    try await save(share.text)   // your existing app:saveFromApp call
                    saved.insert(share.id)
                } catch {
                    print("drainPendingShares: save failed, will retry:", error)
                }
            }
            if !saved.isEmpty {
                SharedInbox.remove(ids: saved)
                await refresh()
            }
        }
    }
}
