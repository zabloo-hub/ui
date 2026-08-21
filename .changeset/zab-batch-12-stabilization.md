---
"@zabloo/cli": patch
---

The preview server now survives what used to kill the whole dev loop: the
request handler has an error boundary (it was async and unawaited — any throw
was an unhandled rejection that took the process down), the envelope name is
encoded into its header (a non-Latin-1 path made `writeHead` throw on the first
`/envelope` fetch), and an unbuilt chrome answers as a 503 with the build
instruction instead of a stack trace on a terminal nobody is watching.
