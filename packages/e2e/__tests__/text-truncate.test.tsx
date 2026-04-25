import { afterEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderWithCss, type RenderWithCssResult } from 'rnwind/testing'

/**
 * End-to-end text-truncate integration: source → rnwind transformer →
 * component mount → assert the rendered `<Text>` receives the
 * transformer-derived `numberOfLines` / `ellipsizeMode` props.
 */

const PRESET = readFileSync(path.resolve(__dirname, '..', '..', 'rnwind', 'preset.css'), 'utf8')
const THEME = `@import 'tailwindcss';\n${PRESET}`

let handle: RenderWithCssResult | null = null
afterEach(() => {
  handle?.cleanup()
  handle = null
})

/**
 * Compile + render a single `<Text>` with the supplied class names and
 * return the host node's props so assertions can read `numberOfLines` /
 * `ellipsizeMode`.
 * @param className Space-separated class names.
 * @returns Host props.
 */
async function mount(className: string): Promise<Record<string, unknown>> {
  handle = await renderWithCss(
    `import { Text } from 'react-native'
     export default () => <Text className="${className}" testID="t">Hello</Text>`,
    { themeCss: THEME },
  )
  return handle.getByTestId('t').props as Record<string, unknown>
}

describe('rnwind — text-truncate end to end', () => {
  it('truncate emits numberOfLines=1 + ellipsizeMode="tail"', async () => {
    const props = await mount('truncate')
    expect(props.numberOfLines).toBe(1)
    expect(props.ellipsizeMode).toBe('tail')
  })

  it('line-clamp-3 emits numberOfLines=3 and no ellipsizeMode', async () => {
    const props = await mount('line-clamp-3')
    expect(props.numberOfLines).toBe(3)
    expect(props.ellipsizeMode).toBeUndefined()
  })

  it('line-clamp-2 + text-clip → clip mode', async () => {
    const props = await mount('line-clamp-2 text-clip')
    expect(props.numberOfLines).toBe(2)
    expect(props.ellipsizeMode).toBe('clip')
  })

  it('line-clamp-none resets a preceding truncate', async () => {
    const props = await mount('truncate line-clamp-none')
    expect(props.numberOfLines).toBeUndefined()
    expect(props.ellipsizeMode).toBeUndefined()
  })

  it('arbitrary line-clamp-[4]', async () => {
    const props = await mount('line-clamp-[4]')
    expect(props.numberOfLines).toBe(4)
  })

  it('text-ellipsis alone does not emit (needs companion line count)', async () => {
    const props = await mount('text-ellipsis')
    expect(props.numberOfLines).toBeUndefined()
    expect(props.ellipsizeMode).toBeUndefined()
  })
})
