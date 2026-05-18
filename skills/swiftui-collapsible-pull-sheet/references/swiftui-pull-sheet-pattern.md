# SwiftUI Collapsible Pull Sheet Pattern

## Source-Derived Anatomy

Use this as a portable implementation guide for a collapsed-to-expanded SwiftUI pull sheet. The constants and choreography below come from a production implementation, but the pattern is intentionally app-agnostic.

Core pieces:

- Parent owns `@State private var sheetDetent: SheetDetent = .collapsed`.
- Parent owns `@State private var sheetProgress: CGFloat = 0` when outside chrome should react.
- Parent builds the sheet inside an overlay/ZStack, not as a system `.sheet`.
- The sheet receives a `SheetMetrics` value derived from `GeometryReader` size and safe-area insets.
- The sheet owns transient `dragTranslation`, optional in-sheet route state, and any nested route depth.

The reference implementation uses:

- `collapsedHeight = 76`.
- `expandedHeight = max(collapsedHeight, size.height - safeAreaInsets.top - topReserve)`.
- `topReserve = 112` in portrait and `34` in landscape.
- Portrait width = full width minus `16` point horizontal margins.
- Landscape width = `min(400, max(330, size.width * 0.24))`, aligned bottom trailing.
- Spring settle = `.spring(response: 0.38, dampingFraction: 0.86)`.
- Drag thresholds from collapsed: expand if `translation.height < -24` or predicted end `< -48`.
- Drag thresholds from expanded: collapse if `translation.height > 36` or predicted end `> 72`.
- Handle = centered capsule, `48 x 5`, dark low-opacity fill.
- Collapsed corner radius = `collapsedHeight / 2`; expanded corner radius = `30`; interpolate by progress.
- Expanded scroll opacity = `max(0, progress * 1.4 - 0.18)`.
- Parent reveal = staged opacity plus a small vertical offset, e.g. `offset(y: (1 - revealOpacity) * 22)`.

## Interaction Model

Compute current height from detent height and drag:

```swift
let baseHeight = metrics.height(for: detent)
let currentHeight = min(metrics.expandedHeight,
                        max(metrics.collapsedHeight, baseHeight - dragTranslation))
```

Compute progress from height:

```swift
let range = max(1, metrics.expandedHeight - metrics.collapsedHeight)
let progress = min(1, max(0, (height - metrics.collapsedHeight) / range))
```

During `onChanged`, disable animations with a transaction so the sheet tracks the finger directly. During `onEnded`, choose a target detent using both actual and predicted translation, then animate detent, reset drag, and update progress together.

## Visual Design Rules

Make the collapsed state read as a floating pill:

- Keep the surface compact and rounded.
- Show only a handle plus a concise header row.
- Use a thumbnail/avatar that grows slightly as the sheet expands.
- Use one-line title in collapsed mode; allow two lines late in expansion.
- Fade expanded scroll content in after initial movement.

Make the expanded state read as a panel:

- Reduce corner radius to a panel radius, about `28-32`.
- Keep the handle visible.
- Use material plus subtle white/tint layers and a thin stroke.
- Clip the sheet body to the animated height.
- Hide scroll indicators unless the local design language expects them.

Coordinate surrounding chrome:

- Expose `expansionProgress` to the parent.
- Fade action rails, zoom sliders, or map controls with formulas like `max(0, 1 - progress * 1.25)`.
- Keep sheet z-index above nearby controls.

## Portable SwiftUI Skeleton

Adapt names and content to the target app.

```swift
private enum PullSheetDetent: CaseIterable {
    case collapsed
    case expanded
}

private struct PullSheetMetrics {
    let size: CGSize
    let safeAreaInsets: EdgeInsets

    var isLandscape: Bool { size.width > size.height }
    var collapsedHeight: CGFloat { 76 }

    var expandedHeight: CGFloat {
        let topReserve: CGFloat = isLandscape ? 34 : 112
        return max(collapsedHeight, size.height - safeAreaInsets.top - topReserve)
    }

    var horizontalPadding: CGFloat { isLandscape ? max(safeAreaInsets.trailing, 0) : 16 }
    var bottomPadding: CGFloat { isLandscape ? 0 : 14 }
    var bottomSafeAreaExtension: CGFloat { isLandscape ? max(safeAreaInsets.bottom, 0) : 0 }

    var sheetWidth: CGFloat {
        isLandscape ? min(400, max(330, size.width * 0.24)) : max(0, size.width - horizontalPadding * 2)
    }

    var contentWidth: CGFloat { max(0, sheetWidth - 40) }
    var alignment: Alignment { isLandscape ? .bottomTrailing : .bottom }

    func height(for detent: PullSheetDetent) -> CGFloat {
        detent == .collapsed ? collapsedHeight : expandedHeight
    }
}

private struct FloatingPullSheet<Header: View, Content: View>: View {
    @Binding var detent: PullSheetDetent
    @Binding var expansionProgress: CGFloat

    let metrics: PullSheetMetrics
    let header: (_ progress: CGFloat) -> Header
    let content: (_ contentWidth: CGFloat) -> Content

    @State private var dragTranslation: CGFloat = 0

    private var currentHeight: CGFloat {
        let baseHeight = metrics.height(for: detent)
        return min(metrics.expandedHeight, max(metrics.collapsedHeight, baseHeight - dragTranslation))
    }

    private var progress: CGFloat {
        progress(forHeight: currentHeight)
    }

    private var cornerRadius: CGFloat {
        let collapsedRadius = metrics.collapsedHeight / 2
        let expandedRadius: CGFloat = 30
        return expandedRadius + (collapsedRadius - expandedRadius) * (1 - progress)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule()
                .fill(Color.black.opacity(0.22))
                .frame(width: 48, height: 5)
                .frame(maxWidth: .infinity)
                .padding(.top, 6)
                .contentShape(Rectangle())
                .gesture(dragGesture)

            header(progress)
                .padding(.horizontal, 14)
                .padding(.top, 2)
                .padding(.bottom, progress > 0.14 ? 14 : 8)
                .contentShape(Rectangle())
                .gesture(dragGesture)
                .onTapGesture(perform: expand)

            ScrollView {
                content(metrics.contentWidth)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 34)
                    .frame(width: metrics.sheetWidth, alignment: .leading)
            }
            .frame(width: metrics.sheetWidth)
            .scrollIndicators(.hidden)
            .scrollDisabled(detent == .collapsed)
            .opacity(Double(max(0, progress * 1.4 - 0.18)))
        }
        .frame(width: metrics.sheetWidth)
        .frame(height: currentHeight, alignment: .top)
        .clipped()
        .background(background)
        .overlay(stroke)
        .shadow(color: .black.opacity(0.10), radius: 22, x: 0, y: 10)
        .padding(.horizontal, metrics.isLandscape ? 0 : metrics.horizontalPadding)
        .padding(.bottom, metrics.bottomPadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: metrics.alignment)
        .transaction { transaction in
            if dragTranslation != 0 {
                transaction.disablesAnimations = true
                transaction.animation = nil
            }
        }
        .onAppear { expansionProgress = progress(for: detent) }
        .onChange(of: detent) { _, newValue in expansionProgress = progress(for: newValue) }
    }

    private var background: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(.ultraThinMaterial)
                .opacity(progress < 0.08 ? 0.82 : 1)

            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Color.white.opacity(progress < 0.08 ? 0.20 : 0.08))

            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(Color.green.opacity(progress < 0.08 ? 0 : 0.08))
        }
    }

    private var stroke: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .stroke(Color.white.opacity(0.48), lineWidth: 1)
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .global)
            .onChanged { value in
                let nextHeight = min(
                    metrics.expandedHeight,
                    max(metrics.collapsedHeight, metrics.height(for: detent) - value.translation.height)
                )

                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    dragTranslation = value.translation.height
                    expansionProgress = progress(forHeight: nextHeight)
                }
            }
            .onEnded { value in
                let next = nextDetent(after: value)
                withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                    detent = next
                    dragTranslation = 0
                    expansionProgress = progress(for: next)
                }
            }
    }

    private func nextDetent(after value: DragGesture.Value) -> PullSheetDetent {
        let drag = value.translation.height
        let predicted = value.predictedEndTranslation.height

        switch detent {
        case .collapsed:
            return (drag < -24 || predicted < -48) ? .expanded : .collapsed
        case .expanded:
            return (drag > 36 || predicted > 72) ? .collapsed : .expanded
        }
    }

    private func expand() {
        guard detent == .collapsed else { return }
        withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
            detent = .expanded
            expansionProgress = progress(for: .expanded)
        }
    }

    private func progress(for detent: PullSheetDetent) -> CGFloat {
        progress(forHeight: metrics.height(for: detent))
    }

    private func progress(forHeight height: CGFloat) -> CGFloat {
        let range = max(1, metrics.expandedHeight - metrics.collapsedHeight)
        return min(1, max(0, (height - metrics.collapsedHeight) / range))
    }
}
```

## Parent Overlay Pattern

Use a parent function like this:

```swift
private func pullSheet(size: CGSize, safeAreaInsets: EdgeInsets) -> some View {
    let metrics = PullSheetMetrics(size: size, safeAreaInsets: safeAreaInsets)
    let canvasHeight = size.height + metrics.bottomSafeAreaExtension

    return FloatingPullSheet(
        detent: $sheetDetent,
        expansionProgress: $sheetProgress,
        metrics: metrics,
        header: { progress in
            CollapsedHeader(progress: progress)
        },
        content: { contentWidth in
            ExpandedContent()
                .frame(width: contentWidth, alignment: .leading)
        }
    )
    .offset(y: CGFloat((1 - sheetRevealOpacity) * 22))
    .opacity(sheetRevealOpacity)
    .allowsHitTesting(sheetRevealOpacity > 0.08)
    .frame(width: size.width, height: canvasHeight, alignment: metrics.alignment)
    .ignoresSafeArea(.container, edges: .bottom)
    .zIndex(25)
}
```

## In-Sheet Route Transitions

When expanded content can drill into a secondary panel, keep route state inside the sheet. Force the sheet to expanded height while a route is active. Use stable `.id(...)` values and asymmetric move-plus-opacity transitions:

```swift
@State private var presentedDetail: Detail?
@State private var routeDepth = 0

@ViewBuilder
private var bodyContent: some View {
    if let presentedDetail {
        DetailPanel(detail: presentedDetail) {
            withAnimation(.spring(response: 0.38, dampingFraction: 0.86)) {
                routeDepth = 0
                self.presentedDetail = nil
            }
        }
        .id("detail")
        .transition(.asymmetric(
            insertion: .move(edge: .trailing).combined(with: .opacity),
            removal: .move(edge: .trailing).combined(with: .opacity)
        ))
    } else {
        MainPanel()
            .id("main")
            .transition(.asymmetric(
                insertion: .move(edge: routeDepth == 0 ? .leading : .trailing).combined(with: .opacity),
                removal: .move(edge: .leading).combined(with: .opacity)
            ))
    }
}
```

## Validation Checklist

- Dragging tracks the finger without implicit animation.
- Release settles with one spring and no jump in height.
- Tap on collapsed header expands.
- Collapsed content remains readable at 76 points.
- Expanded scroll content is not interactive in collapsed mode.
- Parent controls fade as expansion progress increases.
- Portrait respects bottom safe area and 16 point horizontal margins.
- Landscape avoids trailing rails, Dynamic Island/notch areas, and hardware safe-area insets.
- Long titles do not overflow the compact header.
- Reduce Motion users still get understandable state changes if the app supports accessibility motion preferences.
