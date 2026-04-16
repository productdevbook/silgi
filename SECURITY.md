# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Please use GitHub's private disclosure channel:

- [https://github.com/productdevbook/silgi/security/advisories](https://github.com/productdevbook/silgi/security/advisories)

Click **"Report a vulnerability"**. Include:

- A minimal reproduction (code, request payload, environment).
- The version(s) of Silgi you observed the issue on.
- The impact you believe the issue has (information disclosure, denial
  of service, code execution, etc.).

We will acknowledge receipt within **72 hours**, share a preliminary
assessment within **7 days**, and coordinate a release window with you
before publishing the advisory.

## Supported versions

Silgi is pre-1.0 and ships on a fast release cadence. Only the **latest
minor release line** receives security fixes.

| Version | Supported      |
| ------- | -------------- |
| `0.x`, latest minor | Yes (active)   |
| older `0.x`         | No (upgrade)   |

When 1.0 ships we will formalise a longer support window; the current
policy keeps the surface small while the API is still stabilising.

## Security-relevant features

These are features you should understand when building a Silgi service
for a production audience. Each item links back to the source of truth
in the repo.

### Prototype-pollution sanitization

The pipeline sanitizes inputs before merging them into `ctx` or passing
them to user resolvers. See `sanitizeValue` in
[`src/compile.ts`](./src/compile.ts).

- Own-property `__proto__`, `constructor`, and `prototype` keys are
  stripped when rebuilding plain objects.
- Class instances are detected by `Object.getPrototypeOf(value)` and
  left alone — we do not attempt to mutate foreign objects.
- Sanitization recurses into arrays and nested plain objects.

If you ingest parsed bodies via a custom adapter, route them through the
pipeline's parser instead of spreading them directly into `ctx`.

### Input validation via Standard Schema

Silgi accepts any Standard-Schema compatible validator (Zod, Valibot,
ArkType, Effect Schema, etc.). `$input(schema)` and `$output(schema)`
are enforced before and after the resolve step respectively — a failing
schema yields a typed `SilgiError('BAD_REQUEST', { data: issues })` that
is safe to return to clients.

### Typed error boundary

`SilgiError.defined === true` marks errors that were declared via
`$errors()` and are therefore safe to expose verbatim to clients.
Undefined errors are redacted to `INTERNAL_SERVER_ERROR` by
`toSilgiError` in [`src/core/error.ts`](./src/core/error.ts). Never
build your own bypass around this redaction.

### Analytics dashboard auth requirement

The analytics plugin **requires** an `auth` token to mount its
dashboard and admin endpoints. The requirement is enforced in
[`src/plugins/analytics.ts`](./src/plugins/analytics.ts).

Why:

- The dashboard exposes per-request traces that may contain sensitive
  headers, input payloads, and output shape.
- Leaving it unauthenticated on a public service is equivalent to
  publishing a replayable request log.
- Silgi refuses to start the dashboard if `auth` is missing rather than
  defaulting to a weak token — this is a deliberate
  "insecure-by-default is worse than broken-by-default" choice.

The plugin also redacts a built-in list of sensitive header names
(e.g. `authorization`, `cookie`, `x-api-key`) before persisting traces,
regardless of user configuration.

### Cross-realm error identity

`SilgiError` uses `Symbol.for('silgi.error.brand.v1')` on its
prototype. This keeps `instanceof SilgiError` working across worker
threads and `node:vm` contexts without a shared WeakSet. Prefer the
`isSilgiError(e)` helper in library code.

## Threat model

Silgi's threat model covers:

- **Untrusted client input** reaching a procedure: handled via Standard
  Schema validation and prototype-pollution sanitization.
- **Untrusted error propagation** to clients: handled via the `defined`
  flag and `toSilgiError` redaction.
- **Leakage between concurrent requests** (context bleed): the
  per-instance `AsyncLocalStorage` bridge provides per-request
  isolation; the `CTX_POOL` dispose loop wipes keys on release.
- **Accidental exposure of the analytics dashboard**: enforced auth
  token + header redaction.
- **Supply-chain drift in optional integrations**: only explicit
  imports pull in third-party converters (e.g. `silgi/zod`). Silgi
  itself does not hot-load validators based on runtime sniffing.

Explicitly **out of scope**:

- Authenticating end-users of your service. Silgi provides hooks and
  guards for you to build auth on top of — it is not itself an IdP.
- Rate limiting beyond what the `silgi/ratelimit` plugin provides.
- Transport security — deploy behind TLS terminating infrastructure.
- Dependencies of the optional integration packages (Drizzle, Better
  Auth, etc.). Report issues there upstream first.
