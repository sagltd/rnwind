import { Stack } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { StatusBar } from 'expo-status-bar'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { RnwindProvider, type HapticRequest, type HapticTrigger } from 'rnwind'

export type Scheme = 'light' | 'dark' | 'brand'

type SchemeController = {
  scheme: Scheme
  setScheme: (next: Scheme) => void
}

const SchemeControllerContext = createContext<SchemeController | null>(null)

export function useSchemeController(): SchemeController {
  const ctx = useContext(SchemeControllerContext)
  if (!ctx) throw new Error('useSchemeController must be used inside <RootLayout />')
  return ctx
}

/**
 * Dispatcher handed to `<SchemeProvider onHaptics={...}>`. Translates
 * the rnwind-emitted {@link HapticRequest} union into the matching
 * `expo-haptics` call. rnwind itself stays dep-free — consumers bridge
 * the request shape to any haptic library (expo-haptics, expo-go, a
 * custom native module, ...).
 * @param request Structured haptic request emitted by rnwind.
 * @param _trigger Which lifecycle fired (mount / pressIn / focus / hover).
 */
function dispatchHaptic(request: HapticRequest, _trigger: HapticTrigger): void {
  if (request.kind === 'impact') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle[request.style])
    return
  }
  if (request.kind === 'notification') {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType[request.type])
    return
  }
  void Haptics.selectionAsync()
}

export default function RootLayout(): ReactNode {
  const system = useColorScheme()
  const [scheme, setSchemeState] = useState<Scheme>(system === 'dark' ? 'dark' : 'light')
  // Once the user explicitly picks a scheme from the UI we stop mirroring the
  // system. Until then, iOS/Android light↔dark toggles flow straight through.

  useEffect(() => {
    setSchemeState(system === 'dark' ? 'dark' : 'light')
  }, [system])

  const setScheme = useCallback((next: Scheme) => {
    setSchemeState(next)
  }, [])

  const controller = useMemo(() => ({ scheme, setScheme }), [scheme, setScheme])

  return (
    <SafeAreaProvider>
      <SchemeControllerContext.Provider value={controller}>
        <RnwindProvider
          scheme={scheme}
          insets={useSafeAreaInsets()}
          onHaptics={(value) => {
            console.log('Hello.')
            dispatchHaptic(value, 'mount')
          }}>
          <Stack screenOptions={{ headerShown: false }} />
          <StatusBar style={scheme === 'light' ? 'dark' : 'light'} />
        </RnwindProvider>
      </SchemeControllerContext.Provider>
    </SafeAreaProvider>
  )
}
