---
"@zabloo/renderer-web": minor
"@zabloo/format": minor
"@zabloo/react": minor
---

pr: 43

New `disabled` prop on every node, bindable like `visible`. It inherits: disabling a container
disables everything inside it (an `Overlay` starts a fresh chain, so a modal declared inside a
disabled panel stays operable). A disabled node is not focusable, takes no pointer or
navigation input and releases anything it was holding; it still renders, styled through
`states.disabled`, and a disabled `ScrollView` still scrolls. Host calls such as `setValue` and
`setScroll` are not blocked.
