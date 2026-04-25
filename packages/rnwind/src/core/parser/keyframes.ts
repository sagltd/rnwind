import type { Animation, Declaration as LcDeclaration, KeyframeSelector, KeyframesName } from 'lightningcss'

/**
 * Pull the first keyframe name out of a typed `animation` shorthand.
 * @param animations Parsed animation shorthand entries.
 * @returns First ident name, or `null`.
 */
function firstAnimationName(animations: readonly Animation[]): string | null {
  for (const animation of animations) {
    if (animation.name.type === 'ident' || animation.name.type === 'string') return animation.name.value
  }
  return null
}

/**
 * Pull the first ident name from a typed `animation-name` longhand.
 * @param names Animation-name list.
 * @returns First name, or `null`.
 */
function firstNameFromAnimationNames(names: readonly { type: string; value?: string }[]): string | null {
  for (const name of names) {
    if ((name.type === 'ident' || name.type === 'string') && typeof name.value === 'string') return name.value
  }
  return null
}

/**
 * Extract the animation name of an `@keyframes` rule. lightningcss models
 * the name as a discriminated union (`ident` / `custom`); both variants
 * carry the same downstream string.
 * @param raw lightningcss `KeyframesName`.
 * @returns Animation name, or `null` when empty.
 */
export function keyframesName(raw: KeyframesName): string | null {
  if (typeof raw.value !== 'string' || raw.value.length === 0) return null
  return raw.value
}

/**
 * Render a keyframe step's selector list back to CSS-text (`'from'`,
 * `'to'`, or `'50%'`). Timeline-range keyframe selectors (CSS Scroll /
 * View Timelines) can't run in React Native — those steps are skipped.
 * @param selectors Step selectors.
 * @returns Step offset, or `null` when unrepresentable in RN.
 */
export function keyframeSelectorOffset(selectors: readonly KeyframeSelector[]): string | null {
  const [head] = selectors
  if (!head) return null
  switch (head.type) {
    case 'from': {
      return 'from'
    }
    case 'to': {
      return 'to'
    }
    case 'percentage': {
      return `${head.value * 100}%`
    }
    default: {
      return null
    }
  }
}

/**
 * Extract the referenced `@keyframes` name from a declaration whose
 * property is `animation-name` or a shorthand `animation` that names one.
 * Returns the first ident found inside the value — Tailwind's animate-*
 * utilities emit exactly one animation-name per rule.
 * @param decl One declaration from a style rule.
 * @returns Keyframe name, or `null` when the declaration doesn't reference one.
 */
export function pickAnimationName(decl: LcDeclaration): string | null {
  if (decl.property === 'animation') return firstAnimationName(decl.value)
  if (decl.property === 'animation-name') return firstNameFromAnimationNames(decl.value)
  if (decl.property !== 'unparsed') return null
  const targetProperty = decl.value.propertyId.property
  if (targetProperty !== 'animation-name' && targetProperty !== 'animation') return null
  for (const token of decl.value.value) {
    if (token.type === 'token' && token.value.type === 'ident') return token.value.value
    if (token.type === 'dashed-ident') return token.value
  }
  return null
}
