# core/capi — the C ABI

The core's second door. Godot and Unreal enter through C++ (`../src/view.h`);
Unity — and anything with an FFI, one day the visual editor's WASM canvas —
enters through **C**, and `zabloo.h` is that door.

It **wraps `view.h`; it never edits it.** If a binding needs something the C++
surface does not expose, that is a small, separate change to `core/src`, not a
patch in here. What does live here is exactly what a C caller cannot hold for
itself: a frame's batches in C shape, decoded image bytes, the drained arrays,
the last snapshot string — and a `DataValue ⇄ JSON` writer, because the core
reads JSON and deliberately has no writer of its own.

## The contract, in one paragraph

C11, `extern "C"`, every symbol `ZB_EXPORT` and nothing else visible. Opaque
handles (`zb_document`, `zb_view`, `zb_pad`); UTF-8 strings with an explicit
length in both directions; no callback from native to managed — actions, data
writes and diagnostics are **drained** after the frame, which is what the Godot
adapter already does and what an AOT-safe bridge under IL2CPP needs; no
exceptions cross, and `bool`s come back as `int`; one thread. Values travel as
**JSON** both ways (`zb_document_set_data_json`, `zb_data_change.value_json`),
written locale-free as `String(number)` writes them. Every pointer the header
hands out has its **lifetime written on the function** — good until the next
paint, the next layout, the next load, or the next drain of the same kind —
which is what lets C# read them as `NativeArray` views without a copy.

The header is the contract; everything else transcribes it. The C# side is
`sdk/unity/Runtime/Interop/NativeMethods.cs`, and `zb_abi_sizes()` is what
catches the two drifting apart before any corpus case can.

## Build

```sh
scons capi            # core/bin/libzabloo.{dylib,so} / zabloo.dll (+ libzabloo.a)
scons test capi       # the golden corpus, replayed through the header alone
```

Installing it into the Unity package is the package's job: `cd sdk/unity && scons
install` copies the host's library into `Runtime/Plugins/<platform>/` and writes
its import `.meta` (UN3, `sdk/unity/README.md`).

The shared library is the whole core compiled again with hidden visibility, into
`core/obj/capi/` — a foreign build leaves nothing next to the core's sources.
The version it reports (`zb_version()`) is the npm `fixed` group's, read from
`packages/format/package.json` at build time; a checkout without `packages/`
reports `0.0.0-dev` rather than a wrong number.

## The net

`../tests/test_capi.cpp` talks to the core **only through `zabloo.h`** and
replays the 17 metric cases of `golden/` byte for byte, refuses `future-major`
with its code, and pins what a snapshot cannot: pointer lifetimes, a corrupt
load that keeps the previous document, JSON in both directions, and the whole
thing under a Spanish locale (`setlocale`) — the same hole `json.cpp` and
`snapshot.cpp` document for `strtod` and `printf`. `../tests/capi_header_alone.c`
is the header compiled by the **C** compiler, so a C++ construct creeping in
fails at the moment it is written. CI runs both on Linux, macOS and Windows
(`capi-tests`).
