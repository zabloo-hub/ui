---
"@zabloo/renderer-web": minor
"@zabloo/format": minor
"@zabloo/react": minor
---

Implement `disabled`, the last of the seven `StateName`s with no implementation behind it.
It is a bindable prop on `NodeBase` rather than a derived state, because it **inherits**: a
node's effective value is its own OR any ancestor's, so disabling half a form is one prop on
the section. An `Overlay` restarts the chain — a modal declared inside a dimmed panel stays
operable.

A disabled node leaves the interaction model entirely: not focusable, no pointer, no
directional navigation. A press falls **through** it, anything it was holding is released, and
an in-flight Slider gesture is cancelled without committing. A disabled section stays readable
and its ScrollView still scrolls, and the host data channel is never blocked.
