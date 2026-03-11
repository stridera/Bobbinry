# Bobbinry Execution Modes

**Status:** Historical note

Bobbinry originally explored both native and sandboxed bobbins. That is no longer the active runtime architecture.

Today the platform assumes:
- reviewed bobbins live in this repository
- bobbins render as native React components
- legacy `.html` contributions and `execution.mode: sandboxed` are unsupported

Current hardening work focuses on:
- manifest and path validation
- safe HTML rendering for user content
- explicit message origins
- consistent native bobbin UI patterns

If sandboxed bobbins return in the future, they should be designed as a new system rather than reusing the removed iframe runtime.
