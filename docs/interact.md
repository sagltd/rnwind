# Interactive variants & haptics

## `active:` / `focus:`

```tsx
<Pressable className="bg-primary active:bg-primary/80 focus:ring-2">
  <Text className="text-white">Tap me</Text>
</Pressable>
```

The transformer detects `active:` / `focus:` atoms, wraps the host in `<InteractiveBox>`, and wires `useInteract()` so `onPressIn` / `onPressOut` / `onFocus` / `onBlur` flip a state object. The variant atoms gate on that state; the unprefixed atoms always apply.

You keep your own handlers — rnwind chains under them:

```tsx
import { chainPress } from 'rnwind'

<Pressable
  className="active:bg-primary/80"
  onPressIn={chainPress(myHandler, rnwindHandler)}  // both fire
/>
```

(The transformer does this automatically when it sees both your `onPressIn` and a corresponding interactive variant.)

## Skipped hosts

Some RN components don't emit press / focus events. The transformer skips wrapping them in `<InteractiveBox>` — `View`, `Text`, `ScrollView`, `Image`, `FlatList`, `SectionList`, `KeyboardAvoidingView`, `ActivityIndicator`, `RefreshControl`, `Fragment`. Custom components and `Pressable` / `TextInput` always get the wrapper.

## Haptics

Bring your own dispatcher — rnwind stays library-agnostic:

```tsx
import * as Haptics from 'expo-haptics'

<RnwindProvider
  scheme="light"
  onHaptics={(req) => {
    if (req.kind === 'impact')      Haptics.impactAsync(Haptics.ImpactFeedbackStyle[req.style])
    if (req.kind === 'notification') Haptics.notificationAsync(Haptics.NotificationFeedbackType[req.type])
    if (req.kind === 'selection')    Haptics.selectionAsync()
  }}
>
```

Then drop haptic atoms anywhere:

```tsx
<View className="haptic-impact-light" />                   {/* on mount */}
<Pressable className="active:haptic-selection" />          {/* on press-in */}
<TextInput className="focus:haptic-impact-medium" />       {/* on focus */}
```

If `onHaptics` is missing, you'll get a one-shot dev warning per `(kind, trigger)` pair pointing you at the provider — never silent.
