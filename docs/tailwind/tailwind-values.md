# Tailwind CSS v4 — Utility Reference

## How values resolve

Every utility value in v4 comes from one of these mechanisms. Knowing which one a utility uses tells you how to extend or constrain it.

| Mechanism | Example | How it works |
|---|---|---|
| **Static enum** | `flex`, `hidden`, `italic` | Fixed set baked into the utility. No theme hook. |
| **Theme variable** | `bg-red-500` → `--color-red-500` | Reads a CSS custom property from `@theme`. Add the var, the utility appears. |
| **Spacing multiplier** | `p-4` → `calc(var(--spacing) * 4)` | Bare integer × `--spacing` (default `0.25rem`). Unbounded. Used by padding, margin, gap, inset, width/height, translate, scroll-*, border-spacing, etc. |
| **Bare value** | `z-50`, `opacity-75`, `duration-300`, `rotate-45` | Raw number parsed directly (int, %, ms, deg). Unbounded. |
| **Fraction** | `w-1/2`, `basis-3/5` | Computed as percentage. |
| **Arbitrary value** | `w-[23.7%]`, `bg-[#ff0]`, `grid-cols-[1fr_auto_2fr]` | `[...]` bypasses everything. |
| **Custom property** | `bg-(--brand)`, `w-(--sidebar)` | Short-form `var()` reference. |
| **Color + opacity** | `bg-red-500/50` | Any color utility accepts `/n` for alpha. |

Every utility accepts **variants** prepended (`hover:`, `md:`, `dark:`, `group-hover:`, etc. — see the Variants section at the bottom).

> v4 is fundamentally different from v3 here: many utilities accept arbitrary bare numbers (`m-123`, `z-9999`), so there is no finite list of generable classes. The tables below list utility *patterns*, not every concrete class.

---

## Layout

| Utility | Values | Source |
|---|---|---|
| `aspect-*` | `auto`, `square`, `video`, ratios like `3/2`, `[val]` | `--aspect-*` + fractions |
| `columns-*` | `1`–`12`, `3xs`–`7xl`, `auto`, `[val]` | bare int + `--container-*` |
| `break-{before,inside,after}-*` | `auto`, `avoid`, `all`, `avoid-page`, `page`, `left`, `right`, `column` | static |
| `box-border`, `box-content` | — | static |
| *display* | `block`, `inline`, `inline-block`, `flex`, `inline-flex`, `grid`, `inline-grid`, `flow-root`, `contents`, `list-item`, `table`, `table-row`, `table-cell`, …, `hidden` | static |
| `float-*` | `left`, `right`, `start`, `end`, `none` | static |
| `clear-*` | float values + `both` | static |
| `isolate`, `isolation-auto` | — | static |
| `object-{contain,cover,fill,none,scale-down}` | — | static |
| `object-*` (position) | `top`, `bottom`, `left`, `right`, `center`, corners | static |
| `overflow-*`, `overflow-{x,y}-*` | `auto`, `hidden`, `clip`, `visible`, `scroll` | static |
| `overscroll-*`, `overscroll-{x,y}-*` | `auto`, `contain`, `none` | static |
| *position* | `static`, `fixed`, `absolute`, `relative`, `sticky` | static |
| `inset-*`, `inset-{x,y}-*`, `{top,right,bottom,left,start,end}-*` | spacing scale, fractions `1/2`–`11/12`, `full`, `auto`, `px`, `[val]` | `--spacing` + fractions |
| `visible`, `invisible`, `collapse` | — | static |
| `z-*` | integer, `auto`, `[val]` | bare int |

## Flexbox & Grid

| Utility | Values | Source |
|---|---|---|
| `flex-{row,row-reverse,col,col-reverse}` | — | static |
| `flex-{wrap,nowrap,wrap-reverse}` | — | static |
| `flex-*` (shorthand) | `1`, `auto`, `initial`, `none`, `[val]` | static + bare |
| `basis-*` | spacing scale, fractions, `full`, `auto`, container scale (`3xs`–`7xl`) | `--spacing` + `--container-*` |
| `grow`, `grow-*`, `shrink`, `shrink-*` | bare number, `[val]` | bare |
| `order-*` | integer, `first`, `last`, `none`, `[val]` | bare int |
| `grid-cols-*`, `grid-rows-*` | `1`–`12`, `none`, `subgrid`, `[val]` | bare int |
| `col-span-*`, `row-span-*` | `1`–`12`, `full`, `[val]` | bare int |
| `col-{start,end}-*`, `row-{start,end}-*` | `1`–`13`, `auto`, `[val]` | bare int |
| `grid-flow-*` | `row`, `col`, `dense`, `row-dense`, `col-dense` | static |
| `auto-cols-*`, `auto-rows-*` | `auto`, `min`, `max`, `fr`, `[val]` | static |
| `gap-*`, `gap-{x,y}-*` | spacing scale, `[val]` | `--spacing` |
| `justify-*` | `normal`, `start`, `end`, `center`, `between`, `around`, `evenly`, `stretch` | static |
| `justify-{items,self}-*` | `auto`, `start`, `end`, `center`, `stretch` | static |
| `items-*` | `start`, `end`, `center`, `baseline`, `stretch` | static |
| `self-*` | `auto`, `start`, `end`, `center`, `stretch`, `baseline` | static |
| `content-*` | `normal`, `start`, `end`, `center`, `between`, `around`, `evenly`, `stretch`, `baseline` | static |
| `place-{content,items,self}-*` | combined alignment enums | static |

## Spacing

| Utility | Values | Source |
|---|---|---|
| `p-*`, `p{x,y,t,r,b,l,s,e}-*` | spacing scale, `px`, `[val]` | `--spacing` |
| `m-*`, `m{x,y,t,r,b,l,s,e}-*` | spacing scale, `px`, `auto`, `[val]` | `--spacing` |
| `-m-*` | negative spacing | `--spacing` |
| `space-{x,y}-*`, `space-{x,y}-reverse` | spacing scale | `--spacing` |

The spacing scale is open-ended: any non-negative integer works. `p-17`, `m-103` are valid. Override the multiplier with `@theme { --spacing: 0.2rem; }` or disable by unsetting it.

## Sizing

| Utility | Values | Source |
|---|---|---|
| `w-*`, `h-*`, `size-*` | spacing scale, fractions `1/2`–`11/12`, `full`, `screen`, `min`, `max`, `fit`, `auto`, `px`, viewport units (`svw`/`svh`/`lvw`/`lvh`/`dvw`/`dvh`), `[val]` | `--spacing` + static |
| `min-w-*`, `min-h-*` | same as above | same |
| `max-w-*`, `max-h-*` | same + container scale (`3xs`–`7xl`), `prose`, `none` | `--container-*` |

## Typography

| Utility | Values | Source |
|---|---|---|
| `font-*` (family) | `sans`, `serif`, `mono`, custom keys | `--font-*` |
| `font-*` (weight) | `thin`, `extralight`, `light`, `normal`, `medium`, `semibold`, `bold`, `extrabold`, `black`, `[val]` | `--font-weight-*` |
| `font-stretch-*` | `ultra-condensed`…`ultra-expanded`, percentage, `[val]` | static + bare |
| `italic`, `not-italic` | — | static |
| `antialiased`, `subpixel-antialiased` | — | static |
| `text-*` (size) | `xs`, `sm`, `base`, `lg`, `xl`, `2xl`…`9xl`, `[val]` | `--text-*` |
| `text-*` (color) | color palette + `/opacity` | `--color-*` |
| `text-{left,center,right,justify,start,end}` | — | static |
| `text-{wrap,nowrap,balance,pretty}` | — | static |
| `text-{ellipsis,clip}`, `truncate` | — | static |
| `underline`, `overline`, `line-through`, `no-underline` | — | static |
| `decoration-*` (color) | color palette | `--color-*` |
| `decoration-{solid,double,dotted,dashed,wavy}` | — | static |
| `decoration-*` (thickness) | `0`–`8`, `auto`, `from-font`, `[val]` | bare int |
| `underline-offset-*` | `0`–`8`, `auto`, `[val]` | bare int |
| `uppercase`, `lowercase`, `capitalize`, `normal-case` | — | static |
| `tracking-*` | `tighter`, `tight`, `normal`, `wide`, `wider`, `widest`, `[val]` | `--tracking-*` |
| `leading-*` | `none`, `tight`, `snug`, `normal`, `relaxed`, `loose`, OR spacing scale, `[val]` | `--leading-*` + `--spacing` |
| `line-clamp-*` | `1`–`6`, `none`, `[val]` | bare int |
| `list-{disc,decimal,none}`, `list-{inside,outside}` | — | static |
| `list-image-*` | `[url()]`, `none` | arbitrary |
| `whitespace-*` | `normal`, `nowrap`, `pre`, `pre-line`, `pre-wrap`, `break-spaces` | static |
| `break-{normal,words,all,keep}` | — | static |
| `wrap-{break-word,anywhere,normal}` | v4.1 | static |
| `hyphens-{none,manual,auto}` | — | static |
| `content-*` | `none`, `[val]`, `(--var)` | arbitrary |

## Backgrounds

| Utility | Values | Source |
|---|---|---|
| `bg-*` (color) | color palette + `/opacity`, `current`, `transparent`, `black`, `white`, `inherit` | `--color-*` |
| `bg-*` (position) | `top`, `bottom`, `left`, `right`, `center`, corners, `[val]` | static |
| `bg-size-{auto,cover,contain}`, `bg-size-[val]` | — | static |
| `bg-{repeat,no-repeat}`, `bg-repeat-{x,y,space,round}` | — | static |
| `bg-origin-{border,padding,content}` | — | static |
| `bg-clip-{border,padding,content,text}` | — | static |
| `bg-{fixed,local,scroll}` | — | static |
| `bg-linear-to-*`, `bg-linear-<angle>` | direction (`t`, `tr`, `r`, `br`, `b`, `bl`, `l`, `tl`) or angle | static + bare deg |
| `bg-radial`, `bg-radial-[val]` | shape/position | arbitrary |
| `bg-conic`, `bg-conic-<angle>` | angle | bare deg |
| `from-*`, `via-*`, `to-*` (color) | color palette + `/opacity` | `--color-*` |
| `from-*`, `via-*`, `to-*` (position) | `0%`–`100%`, `[val]` | bare % |

> Gradient syntax changed in v4: `bg-gradient-to-r` → `bg-linear-to-r`. New: `bg-radial`, `bg-conic`.

## Borders, Rings, Outlines, Divides

| Utility | Values | Source |
|---|---|---|
| `rounded-*` | `none`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `4xl`, `full`, `[val]` | `--radius-*` |
| `rounded-{t,r,b,l,tl,tr,br,bl,ss,se,ee,es}-*` | same | same |
| `border`, `border-*` (width) | `0`, `2`, `4`, `8`, bare px, `[val]` | bare int |
| `border-{x,y,t,r,b,l,s,e}-*` | same | same |
| `border-*` (color) | color palette | `--color-*` |
| `border-{solid,dashed,dotted,double,hidden,none}` | — | static |
| `outline-*` (width) | `0`–`8`, `[val]` | bare int |
| `outline-*` (color) | color palette | `--color-*` |
| `outline-{solid,dashed,dotted,double,none}` | — | static |
| `outline-offset-*` | `0`–`8`, `[val]` | bare int |
| `ring-*` (width) | `0`, `1`, `2`, `4`, `8`, `[val]` | bare int |
| `ring-*` (color) | color palette | `--color-*` |
| `ring-inset` | — | static |
| `ring-offset-*` | width + color | bare int + `--color-*` |
| `inset-ring-*` | v4: width + color | bare int + `--color-*` |
| `divide-{x,y}-*` | width, `reverse` | bare int |
| `divide-{solid,dashed,…}`, `divide-*` (color) | style + color | static + `--color-*` |

## Effects

| Utility | Values | Source |
|---|---|---|
| `shadow-*` | `2xs`, `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `none`, color, `[val]` | `--shadow-*`, `--color-*` |
| `inset-shadow-*` | same scale | `--inset-shadow-*` |
| `ring-shadow-*` / `shadow-*` color modifier | color palette | `--color-*` |
| `text-shadow-*` (v4.1) | `2xs`, `xs`, `sm`, `md`, `lg`, `none`, color, `[val]` | `--text-shadow-*` |
| `opacity-*` | `0`–`100`, `[val]` | bare int |
| `mix-blend-*`, `bg-blend-*` | `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity`, `plus-darker`, `plus-lighter` | static |
| `mask-*` (v4.1) | image, gradient direction/position/size utilities | theme + arbitrary |

## Filters & Backdrop Filters

Every filter has a `backdrop-*` twin (`backdrop-blur-md`, `backdrop-brightness-50`, …).

| Utility | Values | Source |
|---|---|---|
| `blur-*` | `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `3xl`, `none`, `[val]` | `--blur-*` |
| `brightness-*` | `0`–`200`, `[val]` | bare int |
| `contrast-*` | `0`–`200`, `[val]` | bare int |
| `drop-shadow-*` | `xs`, `sm`, `md`, `lg`, `xl`, `2xl`, `none`, color, `[val]` | `--drop-shadow-*`, `--color-*` |
| `grayscale-*`, `invert-*`, `sepia-*` | `0`–`100`, `[val]` | bare int |
| `hue-rotate-*` | degrees, `[val]` | bare deg |
| `saturate-*` | `0`–`200`, `[val]` | bare int |

## Transitions & Animation

| Utility | Values | Source |
|---|---|---|
| `transition-*` | `all`, `colors`, `opacity`, `shadow`, `transform`, `none`, `[val]` | static |
| `duration-*` | milliseconds (integer), `initial`, `[val]` | bare ms |
| `ease-*` | `linear`, `in`, `out`, `in-out`, `initial`, `[val]` | `--ease-*` |
| `delay-*` | milliseconds, `[val]` | bare ms |
| `animate-*` | `spin`, `ping`, `pulse`, `bounce`, `none`, custom keys | `--animate-*` |

## Transforms

| Utility | Values | Source |
|---|---|---|
| `scale-*`, `scale-{x,y,z}-*` | percent (unbounded), `[val]` | bare % |
| `rotate-*`, `rotate-{x,y,z}-*` | degrees, `[val]` | bare deg |
| `translate-*`, `translate-{x,y,z}-*` | spacing scale, fractions, `full`, `px`, `[val]` | `--spacing` |
| `skew-*`, `skew-{x,y}-*` | degrees, `[val]` | bare deg |
| `transform-{none,cpu,gpu}` | — | static |
| `origin-*` | `center`, `top`, edges, corners, `[val]` | static |
| `perspective-*` | `none`, `dramatic`, `near`, `normal`, `midrange`, `distant`, `[val]` | `--perspective-*` |
| `perspective-origin-*` | positions | static |
| `preserve-3d`, `transform-flat` | — | static |
| `backface-{visible,hidden}` | — | static |

## Interactivity

| Utility | Values | Source |
|---|---|---|
| `accent-*`, `caret-*` | color palette | `--color-*` |
| `appearance-{none,auto}` | — | static |
| `scheme-{normal,dark,light,light-dark,only-dark,only-light}` | — | static |
| `cursor-*` | 30+ keyword values (`pointer`, `wait`, `grab`, …), `[val]` | static |
| `field-sizing-{fixed,content}` (v4.1) | — | static |
| `pointer-events-{none,auto}` | — | static |
| `resize-{none,y,x}`, `resize` | — | static |
| `scroll-{auto,smooth}` | — | static |
| `scroll-m-*`, `scroll-p-*` (+ sides) | spacing scale | `--spacing` |
| `snap-{start,end,center,align-none}` | — | static |
| `snap-{x,y,both,mandatory,proximity,none}` | — | static |
| `snap-{normal,always}` | — | static |
| `touch-{auto,none,manipulation,pinch-zoom}`, `touch-pan-*` | — | static |
| `select-{none,text,all,auto}` | — | static |
| `will-change-{auto,scroll,contents,transform}`, `will-change-[val]` | — | static |

## SVG

| Utility | Values | Source |
|---|---|---|
| `fill-*`, `stroke-*` | color palette, `none` | `--color-*` |
| `stroke-width-*` | `0`–`2`, `[val]` | bare int |

## Tables

| Utility | Values | Source |
|---|---|---|
| `border-{collapse,separate}` | — | static |
| `border-spacing-*`, `border-spacing-{x,y}-*` | spacing scale, `[val]` | `--spacing` |
| `table-{auto,fixed}` | — | static |
| `caption-{top,bottom}` | — | static |

## Accessibility

| Utility | Values | Source |
|---|---|---|
| `sr-only`, `not-sr-only` | — | static |
| `forced-color-adjust-{auto,none}` | — | static |

---

## Variants (prefix modifiers)

Variants chain infinitely: `md:hover:dark:group-focus:bg-red-500/50`.

| Group | Variants | Source |
|---|---|---|
| Breakpoint | `sm:`, `md:`, `lg:`, `xl:`, `2xl:`, and `max-*:` twins | `--breakpoint-*` |
| Container query | `@sm:`, `@md:`, `@lg:`, …, `@max-*:` (needs `@container` ancestor) | `--container-*` |
| Dark mode | `dark:` | media query or class (configurable) |
| Pseudo-class | `hover:`, `focus:`, `focus-visible:`, `focus-within:`, `active:`, `visited:`, `target:`, `first:`, `last:`, `only:`, `odd:`, `even:`, `first-of-type:`, `last-of-type:`, `only-of-type:`, `empty:`, `disabled:`, `enabled:`, `checked:`, `indeterminate:`, `default:`, `required:`, `valid:`, `invalid:`, `user-valid:` (v4.1), `user-invalid:` (v4.1), `in-range:`, `out-of-range:`, `placeholder-shown:`, `autofill:`, `read-only:`, `open:` | static |
| Pseudo-element | `before:`, `after:`, `placeholder:`, `file:`, `marker:`, `selection:`, `first-line:`, `first-letter:`, `backdrop:`, `details-content:` (v4.1) | static |
| Group / Peer | `group-*:`, `peer-*:` (parent/sibling state propagation) | combines with any pseudo |
| Parent state | `has-*:`, `not-*:`, `in-*:` (inherit from ancestor), `*:`, `**:` | CSS `:has()` / `:not()` |
| Attribute | `aria-*:`, `data-*:` | attribute selectors |
| Media | `motion-safe:`, `motion-reduce:`, `print:`, `portrait:`, `landscape:`, `contrast-more:`, `contrast-less:`, `forced-colors:`, `inverted-colors:` (v4.1), `noscript:` (v4.1), `supports-*:`, `pointer-*:`, `any-pointer-*:` | static |
| Direction | `rtl:`, `ltr:` | CSS `:dir()` |
| Arbitrary | `[&:nth-child(3)]:...` selector, `[@media…]:...` media, custom via `@custom-variant` | — |

---

## How the theme maps to utilities

A utility only exists if its backing namespace has values. Adding a key creates the class; removing the namespace removes the whole family.

```css
@theme {
  --color-brand: oklch(0.7 0.2 150);     /* → bg-brand, text-brand, border-brand, ring-brand, … */
  --spacing: 0.25rem;                     /* → p-*, m-*, gap-*, w-*, h-* (as multipliers) */
  --text-xs: 0.75rem;                     /* → text-xs (paired with line-height) */
  --breakpoint-3xl: 120rem;               /* → 3xl: variant */
  --container-8xl: 96rem;                 /* → max-w-8xl, @8xl: */
  --radius-5xl: 3rem;                     /* → rounded-5xl */
  --shadow-glow: 0 0 20px #fff;           /* → shadow-glow */
  --ease-snappy: cubic-bezier(0.2, 0, 0, 1); /* → ease-snappy */
  --animate-wiggle: wiggle 1s infinite;   /* → animate-wiggle */
  --font-display: "Space Grotesk", sans-serif; /* → font-display */
  --font-weight-heavy: 900;               /* → font-heavy */
}

/* Disable a whole namespace */
@theme {
  --color-*: initial;  /* removes all palette-driven color utilities */
}
```

Namespace → utility family map (common ones):

| Namespace | Drives |
|---|---|
| `--color-*` | `bg-*`, `text-*`, `border-*`, `ring-*`, `outline-*`, `fill-*`, `stroke-*`, `from-*`, `via-*`, `to-*`, `accent-*`, `caret-*`, `decoration-*`, `shadow-*` color, `text-shadow-*` color, `divide-*`, `placeholder-*` |
| `--spacing` | `p-*`, `m-*`, `gap-*`, `space-*`, `w-*`, `h-*`, `size-*`, `min-*`, `inset-*`, `translate-*`, `scroll-m-*`, `scroll-p-*`, `border-spacing-*`, `leading-*` (numeric) |
| `--text-*` | `text-{size}` |
| `--font-*` | `font-{family}` |
| `--font-weight-*` | `font-{weight}` |
| `--tracking-*` | `tracking-*` |
| `--leading-*` | `leading-{keyword}` |
| `--breakpoint-*` | `sm:`, `md:`, …variants |
| `--container-*` | `@sm:` container queries, `max-w-*`, `columns-*` |
| `--radius-*` | `rounded-*` |
| `--shadow-*`, `--inset-shadow-*`, `--drop-shadow-*`, `--text-shadow-*` | respective shadow scales |
| `--blur-*` | `blur-*`, `backdrop-blur-*` |
| `--ease-*` | `ease-*` |
| `--animate-*` | `animate-*` |
| `--aspect-*` | `aspect-*` |
| `--perspective-*` | `perspective-*` |