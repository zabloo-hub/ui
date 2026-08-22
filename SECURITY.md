# Security policy

## Supported versions

zabloo/ui is **pre-1.0**. The `@zabloo/*` packages and `create-zabloo-app` are published on
npm, and the supported version is **the latest release** of each: security fixes ship as a
new patch or minor from `main`, not as backports to older 0.x versions. The Unity SDK is not
released yet; until it is, its supported version is whatever is on `main`.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report it privately through GitHub's [Private vulnerability
reporting](https://github.com/zabloo-hub/ui/security/advisories/new) — Security →
Advisories → *Report a vulnerability* on this repository. That opens a draft advisory only
the maintainers can see.

Please include:

- what the problem is and which package or SDK it affects,
- the version or commit you found it on,
- the smallest reproduction you can manage — an envelope, a snippet, or the steps,
- what an attacker gets out of it, as far as you can tell.

You should get an acknowledgement within **5 working days** and an assessment within
**15**. We will keep you updated while a fix is prepared, and we will credit you in the
advisory unless you would rather we did not.

Please give us a reasonable window to ship a fix before disclosing publicly.

## What is in scope

zabloo/ui takes **content authored elsewhere and rendered inside a game** — that is the
whole point of the format, and it is where the interesting boundaries are:

- **The loader and validator** (`@zabloo/format`): an envelope is an untrusted payload. It
  arrives over the network, it can be older or newer than the SDK, and a malformed or
  hostile one must be refused or degraded — never crash the host, and never escape the
  document's own data.
- **The renderers** (`@zabloo/renderer-web`, `sdk/unity`): memory safety and resource
  exhaustion from a crafted envelope — unbounded geometry, atlas or asset sizes, or
  layout that will not terminate.
- **Assets carried in the envelope** (the base64 manifest): anything that gets decoded.
- **The CLI and scaffolder**: path traversal or arbitrary writes outside the project
  directory, and anything that executes content it should only be reading.

## What is not in scope

- Vulnerabilities in a game's own code, or in an engine, that zabloo/ui merely runs inside.
- Issues that need the attacker to already control the developer's machine or the build.
- Findings from automated scanners with no demonstrated impact on this repository.
