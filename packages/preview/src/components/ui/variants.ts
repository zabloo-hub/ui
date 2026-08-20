/**
 * The three class fragments every compacted primitive repeats.
 *
 * They live in one place because they are a CONTRACT with the design, not a
 * convenience: "the focus ring is 1.5px indigo + a 3px halo" has to be one
 * string, or the twelve primitives drift apart the first time someone tunes it.
 *
 * Colour comes from V2 (ZAB-83) in two flavours and this file shows both:
 * shadcn's own tokens are reachable as utilities (`bg-muted`, `border-border`),
 * because V2 maps them into `@theme`; the design's own tokens are not, so they
 * are read as `var(--x)` inside an arbitrary value. Neither one hardcodes a colour.
 */

/**
 * The design's focus ring: the border turns indigo and thickens to 1.5px, with a
 * 3px halo outside it.
 *
 * The 1.5px is `1px border + 0.5px inset shadow` rather than a real 1.5px border
 * because a border change RESIZES the control — the mockup compensates by hand
 * (a 28px input becomes 27px when focused, see artboard 1e) and we are not going
 * to make every consumer do that arithmetic. Every primitive that uses this has
 * `border` in its base, transparent when it has no visible border of its own, so
 * the maths works out the same whether the control is outlined or not.
 *
 * Not shadcn's `ring-offset`: the offset draws a gap in the page background
 * between control and halo, and the design's halo is flush against the border.
 */
export const focusRing =
  "outline-none focus-visible:border-[var(--indigo)] focus-visible:shadow-[inset_0_0_0_0.5px_var(--indigo),0_0_0_3px_var(--ring)]";

/** {@link focusRing} for a frame that focuses through a child input (NumberInput, InputFrame). */
export const focusRingWithin =
  "outline-none focus-within:border-[var(--indigo)] focus-within:shadow-[inset_0_0_0_0.5px_var(--indigo),0_0_0_3px_var(--ring)]";

/**
 * {@link focusRing} for items inside an `overflow-hidden` box — the segmented
 * control. A halo is a box-shadow and the parent clips it, so the ring goes
 * inwards as an outline instead, which is painted over the content and survives.
 */
export const focusRingInset =
  "outline-none focus-visible:outline-[1.5px] focus-visible:outline-[var(--indigo)] focus-visible:-outline-offset-[1.5px]";

/**
 * The 1px lift on triggers and inputs. It is a variable and not `shadow-sm`
 * because in dark the design drops it entirely — V2 resolves `--shadow-control`
 * to `none` there, so the primitives never mention the theme.
 */
export const controlShadow = "shadow-[var(--shadow-control)]";
