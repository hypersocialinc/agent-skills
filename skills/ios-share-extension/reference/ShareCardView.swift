import SwiftUI
import UIKit

// A branded "Save to <app>" card for the share extension. Everything marked CUSTOMIZE is
// app-specific chrome (name, brand gradient, category mapping); the structure — three
// phases (form / saved / signed-out), a live-crawled preview, a category chip — is the
// reusable part. Host it in a UIHostingController with a clear background.

/// A category badge shown in the card (label + SF Symbol). CUSTOMIZE the categories.
struct ShareGuess {
    let label: String
    let symbol: String
}

/// Map your backend's category string to a display label + icon, so the card shows the
/// *real* category after saving. CUSTOMIZE for your taxonomy.
func displayCategory(_ raw: String?) -> ShareGuess? {
    switch raw {
    case "watch":   return ShareGuess(label: "Watch", symbol: "play.rectangle.fill")
    case "books":   return ShareGuess(label: "Books", symbol: "books.vertical.fill")
    case "places":  return ShareGuess(label: "Places", symbol: "mappin.circle.fill")
    default:        return ShareGuess(label: "Saved", symbol: "bookmark.fill")
    }
}

enum AuthState { case checking, signedIn, signedOut }
enum SaveState { case idle, saving, saved, failed }

/// What the extension knows about the share, updated live as the link is crawled and as
/// auth/save progress. The ShareViewController owns and mutates this.
final class ShareModel: ObservableObject {
    @Published var urlText: String = ""
    @Published var title: String = ""
    @Published var host: String? = nil
    @Published var image: UIImage? = nil
    @Published var isLink: Bool = false
    @Published var loading: Bool = true            // crawling link metadata
    @Published var auth: AuthState = .checking
    @Published var saveState: SaveState = .idle
    @Published var savedCategory: ShareGuess? = nil  // the real category from the save
    @Published var category: ShareGuess? = nil        // live preview category
    @Published var classifying: Bool = false

    var canSave: Bool {
        auth == .signedIn && !urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct ShareCardView: View {
    @ObservedObject var model: ShareModel
    var onSave: (String) -> Void
    var onCancel: () -> Void

    @State private var note: String = ""
    @State private var shown = false
    @FocusState private var noteFocused: Bool

    // CUSTOMIZE: your brand gradient.
    private static let brand1 = Color(red: 1.0, green: 0.541, blue: 0.357)
    private static let brand2 = Color(red: 1.0, green: 0.278, blue: 0.494)
    private var brand: LinearGradient {
        LinearGradient(colors: [Self.brand1, Self.brand2],
                       startPoint: .topLeading, endPoint: .bottomTrailing)
    }
    private static let appName = "myapp"   // CUSTOMIZE

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.opacity(shown ? 0.4 : 0)
                .ignoresSafeArea()
                .onTapGesture { if model.saveState != .saving { dismiss(onCancel) } }

            if shown {
                content.transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.4, dampingFraction: 0.88)) { shown = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                if model.auth != .signedOut { noteFocused = true }
            }
        }
    }

    @ViewBuilder private var content: some View {
        switch (model.auth, model.saveState) {
        case (.signedOut, _):  shell { signedOut }
        case (_, .saved):      shell { saved }
        default:               shell { form }
        }
    }

    /// Shared card chrome: grabber + branded header + the phase body.
    private func shell<Body: View>(@ViewBuilder _ body: () -> Body) -> some View {
        VStack(spacing: 16) {
            Capsule().fill(.secondary.opacity(0.4))
                .frame(width: 36, height: 5)
                .padding(.top, 8)

            HStack(spacing: 10) {
                RoundedRectangle(cornerRadius: 9)
                    .fill(brand)
                    .frame(width: 28, height: 28)
                    .overlay(
                        Image(systemName: "bookmark.fill")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(.white)
                    )
                Text("Save to \(Self.appName)")
                    .font(.system(size: 17, weight: .heavy))
                Spacer(minLength: 0)
            }

            body()
        }
        .padding(.horizontal, 18)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(
            .regularMaterial,
            in: UnevenRoundedRectangle(cornerRadii: .init(topLeading: 28, topTrailing: 28))
        )
    }

    // MARK: - Form (signed in, not yet saved)

    @ViewBuilder private var form: some View {
        preview

        TextField("Add a note (optional)", text: $note, axis: .vertical)
            .font(.system(size: 15))
            .lineLimit(1...3)
            .focused($noteFocused)
            .submitLabel(.done)
            .padding(12)
            .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 14))

        Spacer(minLength: 8)

        HStack(spacing: 12) {
            Button { dismiss(onCancel) } label: {
                Text("Cancel")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(Color.primary.opacity(0.08), in: .capsule)
            }
            .buttonStyle(.plain)
            .disabled(model.saveState == .saving)

            Button {
                noteFocused = false
                onSave(note)
            } label: {
                Group {
                    if model.saveState == .saving {
                        ProgressView().tint(.white)
                    } else {
                        Text(model.saveState == .failed ? "Try again" : "Save")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(brand, in: .capsule)
                .opacity(model.canSave ? 1 : 0.5)
            }
            .buttonStyle(.plain)
            .disabled(!model.canSave || model.saveState == .saving)
        }

        if model.saveState == .failed {
            Text("Couldn't reach \(Self.appName). It'll finish saving when you next open the app.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    /// The link as it's crawled: cover (shimmer → image), title, domain, category chip.
    private var preview: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(brand.opacity(0.18))
                if let image = model.image {
                    Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
                } else if model.loading {
                    ProgressView().tint(Self.brand2)
                } else {
                    Image(systemName: model.isLink ? "link" : "note.text")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(brand)
                }
            }
            .frame(width: 60, height: 60)
            .clipShape(.rect(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.primary.opacity(0.06), lineWidth: 1))

            VStack(alignment: .leading, spacing: 4) {
                if model.loading && model.title.isEmpty {
                    shimmerBar(width: 180)
                    shimmerBar(width: 110)
                } else {
                    Text(model.title.isEmpty ? "Untitled" : model.title)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(2)
                    HStack(spacing: 6) {
                        Text(model.loading ? "Reading the link…" : (model.host ?? "Note"))
                            .font(.system(size: 13))
                            .foregroundStyle(model.loading ? Self.brand2 : .secondary)
                        if model.classifying {
                            categoryChip(ShareGuess(label: "Sorting…", symbol: "sparkles"))
                                .redacted(reason: .placeholder)
                        } else if let cat = model.category {
                            categoryChip(cat)
                        }
                    }
                }
            }
            .animation(.easeInOut(duration: 0.25), value: model.loading)
            .animation(.easeInOut(duration: 0.25), value: model.category?.label)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.primary.opacity(0.06), in: .rect(cornerRadius: 16))
        .animation(.easeInOut(duration: 0.3), value: model.image != nil)
    }

    // MARK: - Saved (success)

    @ViewBuilder private var saved: some View {
        Spacer(minLength: 12)
        ZStack {
            Circle().fill(brand.opacity(0.15)).frame(width: 76, height: 76)
            Image(systemName: "checkmark")
                .font(.system(size: 32, weight: .bold))
                .foregroundStyle(brand)
        }
        Text("Saved to \(Self.appName)")
            .font(.system(size: 18, weight: .heavy))
        if let cat = model.savedCategory {
            HStack(spacing: 5) {
                Image(systemName: cat.symbol).font(.system(size: 12, weight: .bold))
                Text("Filed under \(cat.label)").font(.system(size: 14, weight: .semibold))
            }
            .foregroundStyle(Self.brand2)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(Self.brand2.opacity(0.12), in: .capsule)
        }
        Spacer(minLength: 12)
    }

    // MARK: - Signed out

    @ViewBuilder private var signedOut: some View {
        Spacer(minLength: 12)
        Image(systemName: "person.crop.circle.badge.questionmark")
            .font(.system(size: 40, weight: .semibold))
            .foregroundStyle(Self.brand2)
        Text("Sign in to save")
            .font(.system(size: 18, weight: .heavy))
        Text("Open \(Self.appName) and sign in, then share this again.")
            .font(.system(size: 14))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 12)
        Spacer(minLength: 12)
        Button { dismiss(onCancel) } label: {
            Text("Got it")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .background(brand, in: .capsule)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Helpers

    private func categoryChip(_ guess: ShareGuess) -> some View {
        HStack(spacing: 4) {
            Image(systemName: guess.symbol).font(.system(size: 10, weight: .bold))
            Text(guess.label).font(.system(size: 12, weight: .semibold))
        }
        .foregroundStyle(Self.brand2)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(Self.brand2.opacity(0.12), in: .capsule)
    }

    private func shimmerBar(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(Color.primary.opacity(0.12))
            .frame(width: width, height: 11)
            .shimmer()
    }

    private func dismiss(_ action: @escaping () -> Void) {
        noteFocused = false
        withAnimation(.easeIn(duration: 0.18)) { shown = false }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.18, execute: action)
    }
}

/// A light left-to-right sheen for placeholder bars while the link is crawled.
private struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1
    func body(content: Content) -> some View {
        content.overlay(
            LinearGradient(colors: [.clear, .white.opacity(0.5), .clear],
                           startPoint: .leading, endPoint: .trailing)
                .rotationEffect(.degrees(12))
                .offset(x: phase * 220)
                .mask(content)
        )
        .onAppear {
            withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { phase = 1.4 }
        }
    }
}

private extension View {
    func shimmer() -> some View { modifier(Shimmer()) }
}
