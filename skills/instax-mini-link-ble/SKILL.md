---
name: instax-mini-link-ble
description: Use when building software that prints photos to a Fujifilm Instax Mini Link, Mini Link 2, or Mini Link 3 over Bluetooth LE — Swift/CoreBluetooth, Node.js, Web Bluetooth, or Python. Covers opcodes, packet framing, image requirements, and the specific gotchas that produce garbled prints.
---

# Instax Mini Link BLE Protocol

## Overview

The Instax Mini Link family (1, 2, 3) speaks the same custom BLE protocol over a single GATT service. There is no official SDK. The community reverse-engineered the protocol from the Fujifilm mobile app; the canonical Python reference is **[javl/InstaxBLE](https://github.com/javl/InstaxBLE)**. **Mini Link 3 uses the same protocol as Mini Link 1** — it identifies internally as "Mini Link" and accepts the same opcodes.

**Verified empirically:** This skill was written after end-to-end testing against a real Mini Link 3 (`INSTAX-70663700`) from Node.js. The protocol details here produce successful prints.

## When to Use

Use this skill when:
- Building a mobile, desktop, or web app that prints to an Instax Mini Link family printer
- Porting an existing Node.js or Python Instax client to Swift / Kotlin / Web Bluetooth
- Debugging garbled prints (horizontal banding, blank prints, "yellow LED" errors)
- Adding Instax support to a creative tool, photo app, or hardware project

Do **not** use for:
- Instax Square Link or Wide Link (similar protocol, different UUIDs and image dimensions — check `PrinterSettings` in javl/InstaxBLE)
- Instax SP-1, SP-2, SP-3 (older Wi-Fi-based protocols, completely different)
- Instax mini Evo / LiPlay cameras (overlapping but extended command set)

## The Three Gotchas That Will Get You

These are the issues that cost the most time during initial development. Address them first.

### 1. JPEG must be baseline, not progressive

**Symptom:** Photo comes out with horizontal banded stripes instead of an image.

**Cause:** The printer's onboard JPEG decoder reads scans linearly. A progressive JPEG (multiple coarse-to-fine scans of the whole frame) is rendered as bands. `sharp` with `mozjpeg: true` produces progressive output by default. PIL's `Image.save(..., format='JPEG')` produces baseline by default — which is why the Python reference works without thinking about it.

**Fix:**

```js
// Node.js / sharp
sharp(input)
  .resize(600, 800, { fit: 'cover' })
  .jpeg({ quality: 85, progressive: false, mozjpeg: false })  // ← critical
  .toBuffer()
```

```swift
// Swift / Core Image
let context = CIContext()
let jpegData = context.jpegRepresentation(
    of: ciImage,
    colorSpace: CGColorSpaceCreateDeviceRGB(),
    options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption.Key: 0.85]
)
// Core Image's JPEG encoder produces baseline by default. Verify with `file output.jpg` —
// it should say "JPEG image data, baseline" not "progressive".
```

Verify any JPEG before sending: `file output.jpg` should print `baseline`, never `progressive`.

### 2. Opcodes are 2-byte (high, low) tuples, NOT flat 16-bit IDs

Outdated tutorials list opcodes like `0x0001 PRINTER_STATUS`, `0x1101 PRE_PRINT`, `0x1105 PRINT_IMAGE`. **These are wrong.** The real opcodes come from javl/InstaxBLE's `Types.py` as `(high_byte, low_byte)` tuples that get written as **two sequential bytes big-endian on the wire** (which equals `uint16BE` reading).

**There is no `PRINTER_STATUS` (0x0001) opcode** — that's why probing for it returns silence.
**There is no `PRE_PRINT` (0x1101) opcode** — that prefix goes into the `DOWNLOAD_START` payload.

See the [full opcode table](#opcode-reference) below.

### 3. Magic byte case swap on responses

Request packets start with `0x41 0x62` ("Ab"). Response packets start with `0x61 0x42` ("aB"). The printer flips the case to mark direction. A parser that only accepts `Ab` will silently drop every valid response.

```
Request:  41 62 00 07 00 00 55                    "Ab" + len + opcode + checksum
Response: 61 42 00 10 00 00 ... 49                "aB" + len + opcode + payload + checksum
```

## Connection requirements

- **One BLE link at a time.** If the Fujifilm app on a phone is connected, your script cannot connect. Quit the app or turn off the phone's Bluetooth.
- **Don't pair through OS Bluetooth settings.** BLE peripherals connect fresh each session. macOS/iOS pairing fights with direct connections.
- **Bluetooth permission for the host process** (macOS Terminal/IDE Bluetooth toggle, iOS `NSBluetoothAlwaysUsageDescription`).
- **BLE only on real iOS devices** — the Simulator has no BLE stack.

## Packet format

Every command and response uses the same framing:

```
+------+------+--------+--------+----------+----------+
| 0x41 | 0x62 | length |  opcode (BE)      | payload  | checksum |
| 0x61 | 0x42 |  (BE)  | hi  | lo          | (n bytes)| (1 byte) |
+------+------+--------+--------+----------+----------+
  2 bytes  2 bytes      2 bytes              variable    1 byte
  magic    total len    opcode               payload     checksum
```

- `length` = total packet length including magic, length, opcode, payload, and checksum byte. Always `7 + payload.length`.
- `opcode` is big-endian: `(high_byte << 8) | low_byte`.
- `checksum` = `~sum(all_preceding_bytes) & 0xFF` (ones-complement of the sum, low byte).

```js
function buildPacket(opcode, payload = Buffer.alloc(0)) {
  const length = 7 + payload.length;
  const packet = Buffer.alloc(length);
  packet[0] = 0x41; packet[1] = 0x62;
  packet.writeUInt16BE(length, 2);
  packet.writeUInt16BE(opcode, 4);
  payload.copy(packet, 6);
  let sum = 0;
  for (let i = 0; i < length - 1; i++) sum += packet[i];
  packet[length - 1] = (~sum) & 0xff;
  return packet;
}
```

```swift
func buildPacket(opcode: UInt16, payload: Data = Data()) -> Data {
    let length = UInt16(7 + payload.count)
    var packet = Data(capacity: Int(length))
    packet.append(contentsOf: [0x41, 0x62])
    packet.append(contentsOf: [UInt8(length >> 8), UInt8(length & 0xFF)])
    packet.append(contentsOf: [UInt8(opcode >> 8), UInt8(opcode & 0xFF)])
    packet.append(payload)
    let sum = packet.reduce(0) { ($0 + Int($1)) & 0xFF }
    packet.append(UInt8((~sum) & 0xFF))
    return packet
}
```

## BLE service and characteristics

| | UUID |
|---|---|
| Service | `70954782-2d83-473d-9e5f-81e1d02d5273` |
| Write characteristic | `70954783-2d83-473d-9e5f-81e1d02d5273` (properties: `writeWithoutResponse`, `write`) |
| Notify characteristic | `70954784-2d83-473d-9e5f-81e1d02d5273` (properties: `notify`) |

- Advertised local name starts with `INSTAX-` (e.g. `INSTAX-70663700(BLE)`).
- Use **Write Without Response** for sends. Subscribe to notifications on the notify characteristic for responses.
- **MTU chunking:** any logical packet >182 bytes must be split into 182-byte BLE writes. This matters for image data chunks (911 bytes each → 6 sub-writes). On iOS, `peripheral.maximumWriteValueLength(for: .withoutResponse)` typically reports 182.

## Opcode reference

Wire opcode = `(high << 8) | low`, written big-endian. From [`Types.py`](https://github.com/javl/InstaxBLE/blob/main/Types.py) in javl/InstaxBLE.

### Info / status (`0x00xx`)

| Name | Wire | Notes |
|---|---|---|
| `SUPPORT_FUNCTION_AND_VERSION_INFO` | `0x0000` | Hello / capability ping. Empty payload. **Always responds — use as connection sanity check.** |
| `DEVICE_INFO_SERVICE` | `0x0001` | (Do not use as status — silent on Mini Link 3.) |
| `SUPPORT_FUNCTION_INFO` | `0x0002` | **The actual status query.** Payload = single `InfoType` byte. |
| `IDENTIFY_INFORMATION` | `0x0010` | |

### Power / connection (`0x01xx`)

| Name | Wire |
|---|---|
| `SHUT_DOWN` | `0x0100` |
| `RESET` | `0x0101` |
| `AUTO_SLEEP_SETTINGS` | `0x0102` |
| `BLE_CONNECT` | `0x0103` |

### Print flow (`0x10xx`)

| Name | Wire | Payload |
|---|---|---|
| `PRINT_IMAGE_DOWNLOAD_START` | `0x1000` | `[0x02, 0x00, 0x00, 0x00, uint32BE(imageBytes)]` (8 bytes) |
| `PRINT_IMAGE_DOWNLOAD_DATA` | `0x1001` | `[uint32BE(chunkIndex), <900 bytes>]`; last chunk zero-padded to 900 |
| `PRINT_IMAGE_DOWNLOAD_END` | `0x1002` | empty |
| `PRINT_IMAGE_DOWNLOAD_CANCEL` | `0x1003` | empty |
| `PRINT_IMAGE` | `0x1080` | empty — fires the actual print |
| `REJECT_FILM_COVER` | `0x1081` | |

### Firmware (`0x20xx`), LEDs / axis (`0x30xx`), camera (`0x80xx`+)

Less commonly needed. See `Types.py` for the complete list.

### InfoType selector bytes (payload to `SUPPORT_FUNCTION_INFO` / `0x0002`)

**Request payload:** `[selector_byte]` — a single byte.

**Response payload layout:**

```
payload[0]  header byte (observed 0x00 from Mini Link 3)
payload[1]  InfoType selector (echo of the request)
payload[2+] data, layout depends on selector
```

| Selector | Name | Data (payload[2+]) |
|---|---|---|
| `0x00` | `IMAGE_SUPPORT_INFO` | `[width: uint16BE, height: uint16BE]` — Mini = 600×800 |
| `0x01` | `BATTERY_INFO` | `[state: uint8, percent: uint8]` |
| `0x02` | `PRINTER_FUNCTION_INFO` | `[byte]` — `byte & 0x0F` = photos left; `byte & 0x80` = charging |
| `0x03` | `PRINT_HISTORY_INFO` | |
| `0x04` | `CAMERA_FUNCTION_INFO` | (LiPlay / Evo only) |
| `0x05` | `CAMERA_HISTORY_INFO` | (LiPlay / Evo only) |

**Caveat:** Several public reverse-engineering writeups describe response data as starting at payload offset 0 or 1 — both wrong. The reference (`InstaxBLE.py parse_printer_response`) reads `packet[7]` for the selector, which equals payload offset **1** (payload starts at packet[6]). Data starts at payload offset **2**. An off-by-one here will misreport `BATTERY_INFO` as `IMAGE_SUPPORT_INFO` and produce nonsense decoded values.

## End-to-end print flow

The exact sequence the reference implementation uses, in order. Wait for the notify response after each step before sending the next.

```
1.  SUPPORT_FUNCTION_AND_VERSION_INFO   0x0000  []                              → handshake
2.  SUPPORT_FUNCTION_INFO               0x0002  [InfoType.IMAGE_SUPPORT_INFO]   → confirms 600×800
3.  SUPPORT_FUNCTION_INFO               0x0002  [InfoType.BATTERY_INFO]         → battery
4.  SUPPORT_FUNCTION_INFO               0x0002  [InfoType.PRINTER_FUNCTION_INFO]→ photos left; abort if 0
5.  PRINT_IMAGE_DOWNLOAD_START          0x1000  [0x02, 0x00, 0x00, 0x00, len32] → ack
6.  PRINT_IMAGE_DOWNLOAD_DATA           0x1001  [idx32, 900 bytes] × N chunks   → ack per chunk
7.  PRINT_IMAGE_DOWNLOAD_END            0x1002  []                              → ack
8.  PRINT_IMAGE                         0x1080  []                              → print starts
9.  SUPPORT_FUNCTION_INFO               0x0002  [InfoType.PRINTER_FUNCTION_INFO]→ post-print
```

**Critical details:**
- The `0x02 0x00 0x00 0x00` prefix in `DOWNLOAD_START` is **picture type / print options**, not a separate opcode. Setting type to `0x02` selects normal photo print.
- Chunk size is **900 bytes** (defined as `PrinterSettings['mini']['chunkSize']`). For Square = 1200, for Wide = 1200.
- The **last chunk is zero-padded** to 900 bytes. The printer infers the real length from the `imageBytes` value in `DOWNLOAD_START`.
- **Wait for the response notify after each chunk** before sending the next. Don't fire-and-forget; the printer drops or errors.
- **Image data must be ≤ ~105 KB.** Some firmware accept up to 108 KB; community reports of Mini Link 3 needing ~55 KB at times. Compress with quality stepdown.

## Image requirements

| | Mini | Square | Wide |
|---|---|---|---|
| Dimensions | 600 × 800 | 800 × 800 | 1260 × 840 |
| Format | JPEG baseline, RGB | same | same |
| Max size | ~105 KB | ~105 KB | ~105 KB |

- **Always 600×800** for Mini family — non-square photos must be cropped or letterboxed before encoding.
- **Honor EXIF rotation** before resizing. iPhone HEICs especially.
- **Baseline JPEG only.** See [Gotcha #1](#1-jpeg-must-be-baseline-not-progressive).
- **No alpha channel.** Convert RGBA → RGB first.

## Swift / CoreBluetooth port notes

The user of this skill is building a Swift app. Mapping from common cross-language patterns:

| Cross-language concept | Swift / CoreBluetooth |
|---|---|
| Service / characteristic UUIDs | `CBUUID(string: "70954782-2D83-473D-9E5F-81E1D02D5273")` etc. |
| Scan filter | `centralManager.scanForPeripherals(withServices: [serviceUUID])` |
| Connect | `centralManager.connect(peripheral)` then `peripheral(_:didConnect:)` |
| Discover service | `peripheral.discoverServices([serviceUUID])` |
| Discover characteristics | `peripheral.discoverCharacteristics([writeUUID, notifyUUID], for: service)` |
| Subscribe to notifications | `peripheral.setNotifyValue(true, for: notifyChar)` |
| Write packet | `peripheral.writeValue(data, for: writeChar, type: .withoutResponse)` |
| Receive response | `peripheral(_:didUpdateValueFor:error:)` delegate method |
| MTU for sub-writes | `peripheral.maximumWriteValueLength(for: .withoutResponse)` (usually 182) |

**Info.plist** (required on iOS 13+):

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>Connects to your Instax Mini Link printer.</string>
```

**Async/await pattern for one-at-a-time request/response** (Swift 5.5+):

```swift
actor InstaxSession {
    private var pendingContinuation: CheckedContinuation<Data, Error>?
    private var responseBuffer = Data()

    func send(opcode: UInt16, payload: Data = Data(), timeout: TimeInterval = 5) async throws -> Data {
        let packet = buildPacket(opcode: opcode, payload: payload)
        return try await withCheckedThrowingContinuation { cont in
            pendingContinuation = cont
            // split into 182-byte BLE sub-writes
            let mtu = peripheral.maximumWriteValueLength(for: .withoutResponse)
            for chunk in packet.chunked(into: mtu) {
                peripheral.writeValue(chunk, for: writeChar, type: .withoutResponse)
            }
            // optional timeout via Task.sleep + cancel
        }
    }

    // Called from CBPeripheralDelegate.peripheral(_:didUpdateValueFor:error:)
    func didReceive(data: Data) {
        responseBuffer.append(data)
        while let packet = extractPacket(from: &responseBuffer) {
            pendingContinuation?.resume(returning: packet.payload)
            pendingContinuation = nil
        }
    }
}
```

**Packet extraction** must handle either magic (`Ab` for outgoing, `aB` for incoming) and re-sync if framing gets out of step (drop one byte and try again).

**Image preparation** with Core Image produces baseline JPEG by default — verify, but in practice `CIContext.jpegRepresentation` is safe. Avoid `ImageIO`'s `CGImageDestinationCreateWithData` with `kCGImagePropertyJFIFIsProgressive` set to `true`.

## Common mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Progressive JPEG | Horizontal banded stripes | Force baseline with `progressive: false` or use stock JPEG encoder |
| Using `0x0001` for status | Timeout, no response | Use `SUPPORT_FUNCTION_INFO` (`0x0002`) with a selector byte payload |
| Using `0x1101..0x1105` for print | Timeout | Real opcodes are `0x1000`, `0x1001`, `0x1002`, `0x1080` |
| Parser rejects `aB` magic | Status query times out (response *was* sent but parser dropped it) | Accept both `0x41 0x62` and `0x61 0x42` |
| No `02 00 00 00` prefix in `DOWNLOAD_START` | Printer ignores or errors | Prefix is part of payload, not a separate opcode |
| Not zero-padding last image chunk | Printer hangs near end of transfer | Pad to full 900 bytes |
| Image >108 KB | Stuck at `packets left to send: 20` or similar | Re-encode at lower quality |
| Not waiting for per-chunk notify | Partial / corrupted image | Block until response arrives before sending next chunk |
| Sending packet without 182-byte BLE chunking | Large packets fail | Slice `packet` into `mtu`-byte pieces before each `writeValue` |
| Phone still connected to printer | Scan succeeds but connect fails | Quit Fujifilm app or disable phone Bluetooth |
| OS-level pairing of printer | Connection fights | Remove from System Settings → Bluetooth |

## Debugging tips

- **Probe before assuming.** Send opcode `0x0000` first — if it responds, BLE is fine. If it doesn't, fix the connection.
- **Log raw payload hex** for every response. The protocol echoes the request opcode and selector byte, so you can correlate.
- **Pop the film cartridge** while iterating. Connection, status, and image transfer all work fine without film; only the `0x1080` PRINT step errors. Saves film at ~$1/shot.
- **An ESP32-based printer simulator** exists ([dgwilson/ESP32-Instax-Bridge](https://github.com/dgwilson/ESP32-Instax-Bridge)) for fully film-free dev.
- **Yellow LED on the printer = "something unexpected happened"** — usually means image transfer started but didn't complete cleanly. Reset with a long-press of the power button.
- **PacketLogger** (free with Xcode → Additional Tools) can sniff BLE traffic from the official Fujifilm iOS app — useful when this skill's reference falls out of date or for new firmware/models.

## Known-good reference implementation

A working Node.js implementation that successfully prints to a Mini Link 3 lives at `/Users/selcukatli/Projects/instax-test/`. Files of interest:

- `src/protocol.js` — packet framing, opcode constants, `InfoType` enum, status response parsers
- `src/ble.js` — `noble` scan / connect / `InstaxSession` with 182-byte BLE sub-writes and a request/response queue that reassembles fragmented notifications
- `src/image.js` — `sharp`-based 600×800 baseline JPEG encoder with quality stepdown
- `src/index.js` — `scan` / `status` / `print` / `debug` / `probe` / `sweep` subcommands

Port this structure 1:1 into Swift:
- `Protocol.swift` (constants + `buildPacket` + parsers)
- `InstaxSession.swift` (actor wrapping `CBPeripheral` with async send/recv)
- `ImagePrep.swift` (Core Image → 600×800 baseline JPEG)
- `InstaxClient.swift` (high-level `print(image: UIImage)` API)

## References

- [javl/InstaxBLE](https://github.com/javl/InstaxBLE) — Python reference; **canonical opcode source** (`Types.py`)
- [linssenste/instax-link-web](https://github.com/linssenste/instax-link-web) — JS / Web Bluetooth port
- [dgwilson/ESP32-Instax-Bridge](https://github.com/dgwilson/ESP32-Instax-Bridge) — printer simulator (`INSTAX_PROTOCOL.md` has clean protocol writeup)
- javl/InstaxBLE issues [#18](https://github.com/javl/InstaxBLE/issues/18), [#21](https://github.com/javl/InstaxBLE/issues/21), [#24](https://github.com/javl/InstaxBLE/issues/24) — Mini Link 3 compatibility notes
