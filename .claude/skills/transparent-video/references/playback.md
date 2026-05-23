# Playback integration

Per-platform snippets for playing the `.mov` output with alpha preserved. Drop in unchanged or adapt to the target view layer.

## iOS — SwiftUI

The minimum looping transparent player. `AVQueuePlayer` + `AVPlayerLooper` give a seamless loop without round-tripping through `AVPlayerItemDidPlayToEndTime`. `pixelBufferAttributes` is what makes the alpha channel actually composite.

Packaging note: place the `.mov` in an Assets.xcassets **data set** (`Foo.dataset/foo.mov` + `Contents.json`), load via `NSDataAsset`, and write to a memoized temp file. This way Xcode auto-discovers the file like an imageset — no pbxproj surgery. The alternative (registering the file directly in `Resources/`) requires explicit pbxproj entries on most project layouts.

```swift
import AVFoundation
import SwiftUI

struct LoopingVideoView: View {
    let assetName: String      // matches the .dataset name

    var body: some View {
        LoopingVideoRepresentable(assetName: assetName)
            .accessibilityHidden(true)
    }
}

private struct LoopingVideoRepresentable: UIViewRepresentable {
    let assetName: String
    func makeUIView(context: Context) -> LoopingVideoPlayerView {
        LoopingVideoPlayerView(assetName: assetName)
    }
    func updateUIView(_ uiView: LoopingVideoPlayerView, context: Context) {}
}

private final class LoopingVideoPlayerView: UIView {
    private var player: AVQueuePlayer?
    private var looper: AVPlayerLooper?

    override class var layerClass: AnyClass { AVPlayerLayer.self }
    private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

    init(assetName: String) {
        super.init(frame: .zero)
        backgroundColor = .clear
        playerLayer.backgroundColor = UIColor.clear.cgColor
        playerLayer.videoGravity = .resizeAspect
        // Without this the alpha channel is dropped and frames render on black.
        playerLayer.pixelBufferAttributes = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        ]

        guard let asset = NSDataAsset(name: assetName) else { return }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(assetName).mov")
        try? asset.data.write(to: url, options: .atomic)

        let item = AVPlayerItem(url: url)
        let queue = AVQueuePlayer(playerItem: item)
        queue.isMuted = true
        queue.actionAtItemEnd = .advance
        self.player = queue
        self.looper = AVPlayerLooper(player: queue, templateItem: item)
        playerLayer.player = queue
        queue.play()
    }

    required init?(coder: NSCoder) { fatalError() }
}
```

Use it:

```swift
LoopingVideoView(assetName: "BSEmptyChatSlumberLoop")
    .frame(width: 220, height: 220)
```

## Web — HTML

Modern Safari, Chrome, Firefox, and Edge all support HEVC with alpha in `<video>` tags as of 2023+. Older browsers fall back to a transparent first-frame poster.

```html
<video
  src="/assets/hero-loop.mov"
  width="220"
  height="220"
  autoplay
  loop
  muted
  playsinline
  poster="/assets/hero-still.png"
></video>
```

The `playsinline` attribute is mandatory on iOS Safari — without it the video tries to go fullscreen on play.

For broader fallback support (very old browsers), pre-encode a WebM alpha alternative:

```bash
ffmpeg -i hero-loop.mov \
  -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 1M -auto-alt-ref 0 \
  hero-loop.webm
```

```html
<video autoplay loop muted playsinline>
  <source src="/assets/hero-loop.mov" type="video/mp4; codecs=hvc1">
  <source src="/assets/hero-loop.webm" type="video/webm">
</video>
```

## Android — ExoPlayer

ExoPlayer 2.18+ supports HEVC with alpha when the device decoder does. Pixel 6+ and other modern Android devices have hardware HEVC alpha support; older devices fall back to a fully-opaque render.

```kotlin
val player = ExoPlayer.Builder(context).build()
val source = MediaItem.fromUri("asset:///hero-loop.mov")
player.setMediaItem(source)
player.repeatMode = Player.REPEAT_MODE_ONE
player.volume = 0f
player.prepare()
player.play()
```

The `PlayerView` must use a `SurfaceView` (not `TextureView`) for alpha to composite correctly:

```xml
<androidx.media3.ui.PlayerView
    app:surface_type="surface_view"
    .../>
```

For broader Android compatibility (alpha on devices without HEVC alpha hardware), ship a VP9-alpha WebM as the primary asset on Android and HEVC alpha as the primary on iOS.

## React Native / Expo

Use `expo-video` (SDK 51+) which wraps `AVPlayer` on iOS and ExoPlayer on Android:

```tsx
import { VideoView, useVideoPlayer } from 'expo-video';

export function HeroLoop() {
  const player = useVideoPlayer(require('./hero-loop.mov'), (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  return (
    <VideoView
      player={player}
      style={{ width: 220, height: 220 }}
      contentFit="contain"
      nativeControls={false}
    />
  );
}
```

`contentFit="contain"` is the analog of `videoGravity = .resizeAspect` from iOS — preserves aspect ratio without cropping.
