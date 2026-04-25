import type { Declaration as LcDeclaration } from 'lightningcss'
import {
  animationDelayEntries,
  animationDirectionEntries,
  animationDurationEntries,
  animationFillModeEntries,
  animationIterationCountEntries,
  animationNameEntries,
  animationPlayStateEntries,
  animationShorthandToEntries,
  animationTimingFunctionEntries,
  transitionDelayEntries,
  transitionDurationEntries,
  transitionPropertyEntries,
  transitionShorthandToEntries,
  transitionTimingFunctionEntries,
} from './animation'
import { rotateToEntries, scaleToEntries, transformFunctionsToEntries, translateToEntries } from './transform'
import type { RNEntry } from './types'

/**
 * Dispatch motion-adjacent declarations (animation/transition/transform)
 * to their typed handlers. Returns `null` when the declaration isn't
 * one this dispatcher handles, so the caller can fall through to its
 * main switch.
 * @param decl One lightningcss declaration.
 * @returns RN entries when the property matched, else `null`.
 */
export function dispatchMotionDeclaration(decl: LcDeclaration): readonly RNEntry[] | null {
  switch (decl.property) {
    case 'animation': {
      return animationShorthandToEntries(decl.value)
    }
    case 'animation-name': {
      return animationNameEntries(decl.value)
    }
    case 'animation-duration': {
      return animationDurationEntries(decl.value)
    }
    case 'animation-timing-function': {
      return animationTimingFunctionEntries(decl.value)
    }
    case 'animation-iteration-count': {
      return animationIterationCountEntries(decl.value)
    }
    case 'animation-delay': {
      return animationDelayEntries(decl.value)
    }
    case 'animation-direction': {
      return animationDirectionEntries(decl.value)
    }
    case 'animation-fill-mode': {
      return animationFillModeEntries(decl.value)
    }
    case 'animation-play-state': {
      return animationPlayStateEntries(decl.value)
    }
    case 'transition': {
      return transitionShorthandToEntries(decl.value)
    }
    case 'transition-property': {
      return transitionPropertyEntries(decl.value)
    }
    case 'transition-duration': {
      return transitionDurationEntries(decl.value)
    }
    case 'transition-timing-function': {
      return transitionTimingFunctionEntries(decl.value)
    }
    case 'transition-delay': {
      return transitionDelayEntries(decl.value)
    }
    case 'transform': {
      return transformFunctionsToEntries(decl.value)
    }
    case 'rotate': {
      return rotateToEntries(decl.value)
    }
    case 'translate': {
      return translateToEntries(decl.value)
    }
    case 'scale': {
      return scaleToEntries(decl.value)
    }
    default: {
      return null
    }
  }
}
