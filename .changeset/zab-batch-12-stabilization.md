---
"@zabloo/cli": patch
---

pr: 86

The preview server no longer dies on a request that throws: an unhandled error answers 500, an
envelope name with characters a header cannot carry is encoded (and decoded by the page), and
an unbuilt preview answers 503 with the build instruction.
