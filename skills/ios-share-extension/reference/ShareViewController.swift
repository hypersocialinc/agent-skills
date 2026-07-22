import ClerkKit
import ConvexMobile
import LinkPresentation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Your save action's return. Shape it to whatever your Convex action returns.
private struct ShareSaveAck: Decodable {
    let id: String
    let category: String?
}

/// (Optional) the read-only category preview action's return.
private struct ClassifyAck: Decodable {
    let category: String
}

/// Hosts the "Save to <app>" card and saves through the *same* authenticated Convex
/// action the app uses — by sharing the app's Clerk session via a keychain access group.
/// No new backend path: the server classifies + enriches exactly as it does in-app.
final class ShareViewController: UIViewController {

    private let model = ShareModel()
    private static var clerkConfigured = false
    /// One authed client reused for the live preview and the save.
    private var client: ConvexClientWithAuth<String>?
    private var classifyStarted = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        configureClerkOnce()

        let card = ShareCardView(
            model: model,
            onSave: { [weak self] note in self?.save(note: note) },
            onCancel: { [weak self] in self?.cancel() }
        )
        let host = UIHostingController(rootView: card)
        host.view.backgroundColor = .clear   // let the dimmed backdrop show through
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)

        extractSharedContent()
        loadAuth()
    }

    // MARK: - Auth

    private func configureClerkOnce() {
        guard !Self.clerkConfigured else { return }
        Self.clerkConfigured = true
        // Same service + access group as the app, so we read its cached session.
        _ = Clerk.configure(
            publishableKey: Config.clerkPublishableKey,
            options: .init(keychainConfig: .init(
                service: SharedAuth.keychainService,
                accessGroup: SharedAuth.keychainAccessGroup
            ))
        )
    }

    private func loadAuth() {
        // configure() loads the cached client synchronously, so the session shared via the
        // keychain is already readable here.
        model.auth = (Clerk.shared.user != nil) ? .signedIn : .signedOut
        maybeClassify()
    }

    /// A logged-in Convex client, built once and reused. `ClerkConvexAuthProvider` is your
    /// app's existing bridge from Clerk's token to Convex's auth — reuse it verbatim.
    private func ensureClient() async -> ConvexClientWithAuth<String>? {
        guard model.auth == .signedIn else { return nil }
        if let client { return client }
        let c = ConvexClientWithAuth<String>(
            deploymentUrl: Config.convexURL,
            authProvider: ClerkConvexAuthProvider()
        )
        _ = await c.login()
        client = c
        return c
    }

    /// (Optional) once signed in and the link is crawled, run a *read-only* classifier so
    /// the preview chip matches the category saving will produce.
    private func maybeClassify() {
        guard !classifyStarted, model.auth == .signedIn,
              !model.loading, !model.urlText.isEmpty else { return }
        classifyStarted = true
        model.classifying = true
        Task { @MainActor in
            defer { model.classifying = false }
            guard let client = await ensureClient() else { return }
            do {
                let res: ClassifyAck = try await client.action(
                    "app:classifyShare",
                    with: ["text": model.urlText, "title": model.title]
                )
                model.category = displayCategory(res.category)
            } catch {
                // Best-effort preview; the real category still shows after saving.
            }
        }
    }

    // MARK: - Save / cancel

    private func save(note: String) {
        guard model.auth == .signedIn else { return }
        let base = model.urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNote = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let combined = [trimmedNote, base].filter { !$0.isEmpty }.joined(separator: "\n")
        guard !combined.isEmpty else { return }

        model.saveState = .saving
        Task { @MainActor in
            do {
                guard let client = await ensureClient() else {
                    throw NSError(domain: "com.example.myapp.share", code: 1)
                }
                let ack: ShareSaveAck = try await client.action(
                    "app:saveFromApp", with: ["text": combined]
                )
                model.savedCategory = displayCategory(ack.category)
                model.saveState = .saved
                try? await Task.sleep(for: .seconds(1.2))
                extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
            } catch {
                // Don't lose it: queue for the app to finish saving on next launch.
                SharedInbox.append(PendingShare(text: combined))
                model.saveState = .failed
            }
        }
    }

    private func cancel() {
        extensionContext?.cancelRequest(
            withError: NSError(domain: "com.example.myapp.share", code: 0)
        )
    }

    // MARK: - Extract + crawl

    private func extractSharedContent() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem else {
            finishText("")
            return
        }
        let pageTitle = item.attributedContentText?.string
        let providers = item.attachments ?? []
        let urlType = UTType.url.identifier

        if let urlProvider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(urlType)
        }) {
            urlProvider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] value, _ in
                let url = (value as? URL) ?? (value as? String).flatMap(URL.init(string:))
                DispatchQueue.main.async {
                    if let url {
                        self?.startLink(url: url, fallbackTitle: pageTitle)
                    } else {
                        self?.finishText((value as? String) ?? pageTitle ?? "")
                    }
                }
            }
            return
        }

        let textType = UTType.plainText.identifier
        if let textProvider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(textType)
        }) {
            textProvider.loadItem(forTypeIdentifier: textType, options: nil) { [weak self] value, _ in
                DispatchQueue.main.async {
                    let s = (value as? String) ?? ""
                    if let url = URL(string: s), url.scheme?.hasPrefix("http") == true {
                        self?.startLink(url: url, fallbackTitle: pageTitle)
                    } else {
                        self?.finishText(s.isEmpty ? (pageTitle ?? "") : s)
                    }
                }
            }
            return
        }

        finishText(pageTitle ?? "")
    }

    private func startLink(url: URL, fallbackTitle: String?) {
        model.urlText = url.absoluteString
        model.host = url.host?.replacingOccurrences(of: "www.", with: "")
        model.isLink = true
        model.loading = true
        if let t = fallbackTitle, !t.isEmpty { model.title = t }

        let provider = LPMetadataProvider()
        provider.timeout = 8
        provider.startFetchingMetadata(for: url) { [weak self] metadata, _ in
            guard let self else { return }
            let title = metadata?.title
            if let imageProvider = metadata?.imageProvider ?? metadata?.iconProvider {
                imageProvider.loadObject(ofClass: UIImage.self) { object, _ in
                    DispatchQueue.main.async {
                        if let image = object as? UIImage { self.model.image = image }
                    }
                }
            }
            DispatchQueue.main.async {
                if let title, !title.isEmpty { self.model.title = title }
                self.model.loading = false
                self.maybeClassify()
            }
        }
    }

    private func finishText(_ text: String) {
        model.urlText = text
        model.title = text.isEmpty ? "Untitled" : text
        model.host = nil
        model.isLink = false
        model.loading = false
        maybeClassify()
    }
}
