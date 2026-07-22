import Foundation

/// One item handed from the Share Extension to the host app through the shared App Group
/// container. The app drains these when it next becomes active and saves each through
/// the normal authenticated save path, so the extension never needs to succeed online.
///
/// This file belongs in a `Shared/` folder compiled into BOTH targets.
struct PendingShare: Codable, Identifiable {
    let id: UUID
    /// The URL or text to save (optionally prefixed with the user's note).
    let text: String
    let createdAt: Date

    init(id: UUID = UUID(), text: String, createdAt: Date = Date()) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
    }
}

/// A tiny queue backed by the App Group's `UserDefaults`, shared by the host app and the
/// Share Extension (two processes). Append-from-extension, drain-from-app. This is the
/// safety net: a save that can't reach the network is queued here, not lost.
enum SharedInbox {
    /// MUST match the `com.apple.security.application-groups` entitlement on BOTH the app
    /// and the extension, exactly.
    static let appGroup = "group.com.example.myapp"
    private static let key = "pendingShares"

    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    static func append(_ share: PendingShare) {
        var items = all()
        items.append(share)
        write(items)
    }

    static func all() -> [PendingShare] {
        guard let data = defaults?.data(forKey: key),
              let items = try? JSONDecoder().decode([PendingShare].self, from: data)
        else { return [] }
        return items.sorted { $0.createdAt < $1.createdAt }
    }

    static func remove(ids: Set<UUID>) {
        write(all().filter { !ids.contains($0.id) })
    }

    static func clear() {
        defaults?.removeObject(forKey: key)
    }

    private static func write(_ items: [PendingShare]) {
        guard let data = try? JSONEncoder().encode(items) else { return }
        defaults?.set(data, forKey: key)
    }
}
