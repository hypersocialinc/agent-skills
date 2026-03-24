# Expo / React Native

## Goal
Implement a blur that is strong at the bottom and transparently fades out toward the top.

## Required Packages
- `expo-blur`
- `expo-linear-gradient`
- `@react-native-masked-view/masked-view`

Install in mobile workspace:

```bash
pnpm --filter @nook/mobile add @react-native-masked-view/masked-view
```

## Pattern
Use a `MaskedView` where:
- `maskElement` is a vertical `LinearGradient` with alpha ramp.
- child is `BlurView` filling bounds.

```tsx
import MaskedView from "@react-native-masked-view/masked-view";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { View } from "react-native";

function BottomToTopMaskedBlur() {
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "58%" }} pointerEvents="none">
      <MaskedView
        style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
        maskElement={
          <LinearGradient
            colors={["rgba(0,0,0,1)", "rgba(0,0,0,0.78)", "rgba(0,0,0,0.24)", "transparent"]}
            locations={[0, 0.4, 0.74, 1]}
            start={{ x: 0.5, y: 1 }}
            end={{ x: 0.5, y: 0 }}
            style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
          />
        }
      >
        <BlurView tint="dark" intensity={42} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />
      </MaskedView>
    </View>
  );
}
```

## Optional Contrast Layer
After the masked blur, optionally add a low-opacity dark gradient for text legibility:

```tsx
<LinearGradient
  colors={["rgba(0,0,0,0.42)", "rgba(0,0,0,0.24)", "rgba(0,0,0,0.08)", "transparent"]}
  locations={[0, 0.4, 0.74, 1]}
  start={{ x: 0.5, y: 1 }}
  end={{ x: 0.5, y: 0 }}
  style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }}
/>
```

## Anti-Patterns
- Do not use one full-height `BlurView` plus a tint gradient and call it "fading blur."
- Do not stack multiple blur layers high enough to leave haze at the top edge.

## Tuning Knobs
- Increase blur strength: `intensity`.
- Increase fade length: shift `locations` midpoint toward `1`.
- Reduce top haze: reduce middle alpha values in `maskElement`.
