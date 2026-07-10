# The speech engine: two backends behind one facade

Live push-to-talk transcription with a mic-level signal for the UI. iOS 26 gets
`SpeechAnalyzer` + `SpeechTranscriber` (the model behind Notes/Voice Memos — real
punctuation, proper nouns, no one-minute ceiling); earlier systems keep
`SFSpeechRecognizer`. If the modern path can't run (locale unsupported, model not
downloaded, reservation failed), a hold **silently falls back** to the legacy engine
rather than failing — log every fallback or a broken modern path is undiagnosable.

## Shape

```swift
@MainActor @Observable
final class SpeechRecognizer {
    static let log = Logger(subsystem: "<your.bundle.id>", category: "speech")

    private(set) var transcript = ""          // partial while recording; final after stop()
    private(set) var level: Double = 0        // smoothed loudness 0…1, drives the orb
    private(set) var isRecording = false
    private(set) var permissionDenied = false // callers MUST surface this (see agent-wiring.md)
    @ObservationIgnored private var backend: (any SpeechBackend)?
    @ObservationIgnored private var holdToken: UInt = 0
    @ObservationIgnored private var authorized = false

    func prewarm() { /* model download, once, at screen-appear — never inside a hold */ }
    func start() async throws { /* see below */ }
    func stop() { /* see below */ }
}
```

The backends share a protocol so the facade picks at runtime. Keep the protocol free of
availability annotations — an `@available` protocol can't type a stored property on a
class that also supports older iOS:

```swift
@MainActor
private protocol SpeechBackend: AnyObject {
    var onTranscript: ((String) -> Void)? { get set }
    var onLevel: (@Sendable @MainActor (Double) -> Void)? { get set }  // hops from audio thread
    var onFinish: (() -> Void)? { get set }   // engine ended the capture on its own
    func stop()
}
```

`wire`/`unwire` discipline: set all three callbacks before `start()`, and **nil them
before tearing a backend down** — a dying engine's `onFinish` firing into the facade
would stop whichever backend replaced it.

## The quick-tap race (the #1 shipped bug in this pattern)

`start()` is async with several suspension points (permission prompt, session
activation ~100–265ms, engine start ~40ms). `stop()` is synchronous. A quick tap
releases *while start() is suspended* — a naive `guard isRecording` in `stop()` no-ops,
then `start()` finishes and commits an orphaned capture: mic indicator lit, audio
ducked, no UI. First-ever use is the worst case (the permission dialog guarantees it).

Fix — a monotonic hold token, re-checked after **every** suspension:

```swift
func start() async throws {
    guard !isRecording else { return }
    holdToken &+= 1               // a newer start invalidates any older in-flight one
    let hold = holdToken
    guard await ensureAuthorized() else { throw SpeechError.unauthorized }
    guard hold == holdToken else { return }        // released during the permission prompt
    transcript = ""

    if #available(iOS 26, *) {
        let modern = ModernBackend()
        wire(modern)
        do {
            try await modern.start()
            guard hold == holdToken else { unwire(modern); modern.stop(); return }
            backend = modern; isRecording = true; return
        } catch {
            Self.log.error("modern engine failed, falling back: \(String(describing: error))")
            unwire(modern); modern.stop()          // sever callbacks BEFORE teardown
        }
    }
    let legacy = LegacyBackend()
    wire(legacy)
    try await legacy.start()
    guard hold == holdToken else { unwire(legacy); legacy.stop(); return }
    backend = legacy; isRecording = true
}

func stop() {
    holdToken &+= 1               // cancels any start() still in flight
    guard isRecording else { return }
    isRecording = false
    if let backend { unwire(backend); backend.stop() }
    backend = nil
    level = 0
}
```

## The audio session actor (press latency + activation races)

`AVAudioSession.setActive` is documented-slow (100ms+ while the media server reroutes);
called from a main-actor `start()` it stalls the first frames of the press animation.
And with activation (press) and deactivation (release) as independent detached tasks, a
quick re-press can have the OLD hold's deactivation land after the NEW hold's
activation and kill the session under a running engine. An actor gives off-main *and*
serialized at once:

```swift
private actor AudioSessionCoordinator {
    static let shared = AudioSessionCoordinator()
    func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
    }
    func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
```

`AVAudioEngine.start()` also blocks for tens of ms — hop it off too:

```swift
private func startAudioEngine(_ engine: AVAudioEngine) async throws {
    try await Task.detached(priority: .userInitiated) {
        engine.prepare(); try engine.start()
    }.value
}
```

## iOS 26 modern backend — the silent-failure minefield

Every one of these was hit in production bring-up. In order:

1. **`AssetInventory.reserve(locale:)` gates USE, not just download.** An analyzer
   built on an unallocated locale starts fine, throws nothing, logs "Cannot use modules
   with unallocated locales", and transcribes silence. Reserve in `start()` even when
   the model is already on disk (it can be installed system-wide by another app).
2. **`reserve` returns `false` for a locale that's already held.** Check membership in
   `AssetInventory.reservedLocales` (compare `identifier(.bcp47)`); never trust the
   return value alone.
3. **`.progressiveTranscription` preset, not `.transcription`.** Only the progressive
   preset emits *volatile* results (the live hypothesis); the plain one emits finals
   only, leaving the caption blank until release. Accumulate finals in an
   `AttributedString`; append the volatile tail for display but never store it.
4. **Never download the model inside a hold.** `installModelIfNeeded()` runs once at
   screen-appear (`prewarm()`); `start()` *checks* `isModelInstalled` and throws
   `.unavailable` so the legacy engine takes the hold.
5. **`.unsupported` from `AssetInventory.status(forModules:)` means this hardware can't
   run the model at all — notably the Simulator.** Skip the download; only the legacy
   path is testable on sim.
6. **Read the mic format only AFTER session activation.** Activation with
   `.measurement` can change the hardware sample rate; `installTap` with a stale format
   doesn't throw, it raises an NSException and crashes. Also guard degenerate formats
   (`sampleRate > 0, channelCount > 0` — 0Hz happens between session transitions).
7. **Convert every buffer to the analyzer's format** (`SpeechAnalyzer
   .bestAvailableAudioFormat(compatibleWith:)` + `AVAudioConverter`) on the audio
   thread. In the converter's input block, hand it the one buffer then report
   `.noDataNow` — returning `.endOfStream` retires the converter after the first tap.
8. **Teardown**: on `stop()`, cancel the results task, `finish()` the input
   continuation, and `analyzer.cancelAndFinishNow()` (push-to-talk already took the
   transcript; don't wait for a finalization pass). In the results task's `catch`,
   check `Task.isCancelled` before firing `onFinish` — cancellation surfaces as an
   error, and firing then would stop the *replacement* backend.

## The tap and the level pipeline

The tap runs on the audio thread. Capture the callback, not `self`:

```swift
let onLevel = self.onLevel
input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { buffer, _ in
    if let onLevel {
        let rms = rmsAmplitude(buffer)          // measure the mic, not the converted copy
        Task { @MainActor in onLevel(rms) }
    }
    // modern: convert + yield AnalyzerInput; legacy: request.append(buffer)
}
```

**Buffer size 1024, not 4096.** 1024 frames ≈ 47Hz at the native rate; `level` drives
blur radii and wobble amplitudes, and at 4096 (~12Hz) every level-driven visual steps
visibly between updates.

Facade-side smoothing — perceptual dB mapping with asymmetric attack/decay, so a
consonant lands on the frame it happens but the orb doesn't strobe between syllables:

```swift
private func ingest(_ rms: Double) {
    let decibels = 20 * log10(max(rms, 1e-6))          // ≈ -120 silence … 0 clipping
    let target = min(1, max(0, (decibels + 50) / 50))
    let rate = target > level ? 0.35 : 0.09            // leap up, fall away slowly
    level += (target - level) * rate
}
```

## Legacy backend notes

- `request.shouldReportPartialResults = true`; set `requiresOnDeviceRecognition` only
  where `supportsOnDeviceRecognition` — and be honest in your privacy copy: without
  on-device support this path goes through Apple's server.
- The recognition callback is off the main actor — extract Sendable values (`text`,
  `done`), then hop to `@MainActor` once.

## Permissions & project config

- Info.plist (via xcodegen `project.yml` or directly): `NSMicrophoneUsageDescription`
  and `NSSpeechRecognitionUsageDescription` — the app crashes on first mic touch
  without them.
- Request lazily on first `start()`: `SFSpeechRecognizer.requestAuthorization` +
  `AVAudioApplication.requestRecordPermission` (iOS 17+; `AVAudioSession`'s variant
  before). Cache the grant — it can't be revoked mid-session.
- `permissionDenied` is worthless unless a caller reads it. See
  `agent-wiring.md` for the mandatory error boundary.
