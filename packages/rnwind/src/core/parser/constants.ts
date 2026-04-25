/** 1 rem = 16 px — matches the CSS default so unit-bare Tailwind spacing stays predictable. */
export const REM_TO_PX = 16

// Hot-path regexes hoisted to module scope so they're compiled once per
// process; an inline literal would recompile on every declaration.
export const BARE_NUMBER_REGEX = /^-?\d+(?:\.\d+)?$/
export const LENGTH_PX_REGEX = /^(-?\d+(?:\.\d+)?)px$/
export const LENGTH_REM_REGEX = /^(-?\d+(?:\.\d+)?)rem$/
export const CALC_RATIO_REGEX = /^calc\(\s*(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)\s*\)$/
export const CALC_MUL_REGEX = /^calc\(\s*(-?\d+(?:\.\d+)?)(?:px|rem)?\s*\*\s*(-?\d+(?:\.\d+)?)\s*\)$/
export const KEBAB_BOUNDARY_REGEX = /-([a-z])/g
