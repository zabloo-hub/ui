---
"@zabloo/format": patch
---

pr: 49

`readEnvelope` rejects an inverted `Slider` range when only one bound is declared
(`{ min: 5 }` against the default `max` of 1), not only when both are.
