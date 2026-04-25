import { afterEach, describe, expect, it } from 'bun:test'
import * as React from 'react'
import { render } from '@testing-library/react-native'
import { Text, View } from 'react-native'
import { useCss } from '../../rnwind/src/runtime/hooks/use-css'
import { evaluateTransformedComponent, flatten, transformAndRegister, type HarnessHandle } from './helpers/harness'

let harness: HarnessHandle | null = null
afterEach(() => {
  harness?.teardown()
  harness = null
})

/**
 * Print-everything probes — they assert the same thing the proper render
 * tests do, but ALSO log the raw style array so a skeptical reader can
 * see with their own eyes that `bg-primary` actually carries the
 * registered color through to the rendered RN element.
 */

describe('PROOF: <View className="bg-primary" /> resolves to a real color on the rendered element', () => {
  it('logs the raw style + backgroundColor for bg-primary', async () => {
    harness = await transformAndRegister(
      `import { View } from 'react-native'
       export default () => <View className="bg-primary p-3" testID="proof" />`,
      {
        themeCss: `@import 'tailwindcss';
@theme {
  --color-primary: #ff0099;
}
`,
      },
    )
    const Component = evaluateTransformedComponent(harness.transformedSource, { View, Text })
    const { getByTestId } = render(<Component />)
    const node = getByTestId('proof')

    // eslint-disable-next-line no-console
    console.log('\n--- transformer output ---\n' + harness.transformedSource)
    // eslint-disable-next-line no-console
    console.log('\n--- raw style prop on the rendered <View> ---\n', node.props.style)
    const flat = flatten(node.props.style)
    // eslint-disable-next-line no-console
    console.log('\n--- flattened style ---\n', flat)

    expect(flat.backgroundColor).toBe('#ff0099')
    expect(flat.padding).toBe(12)
  })
})

describe('PROOF: useCss("bg-primary") returns a style array containing the registered color', () => {
  it('logs the array useCss returns + the rendered style', async () => {
    harness = await transformAndRegister(
      `import { View } from 'react-native'
       export default () => <View className="bg-primary" />`,
      {
        themeCss: `@import 'tailwindcss';
@theme {
  --color-primary: #00cc88;
}
`,
      },
    )
    /**
     * Probe: just call useCss and pass the result as `style`. No magic.
     * @returns Probe element.
     */
    function Probe(): React.ReactElement {
      const styleArray = useCss('bg-primary')
      // eslint-disable-next-line no-console
      console.log('\n--- useCss("bg-primary") returned ---\n', styleArray)
      return <View testID="probe" style={styleArray as never} />
    }
    const { getByTestId } = render(<Probe />)
    const node = getByTestId('probe')

    // eslint-disable-next-line no-console
    console.log('\n--- raw style prop on the rendered <View> ---\n', node.props.style)
    const flat = flatten(node.props.style)
    // eslint-disable-next-line no-console
    console.log('\n--- flattened style ---\n', flat)

    expect(flat.backgroundColor).toBe('#00cc88')
  })
})
