# Bobbinry Execution Modes — Native vs Sandboxed

**Status:** Architectural Decision (v0.2)  
**Purpose:** Define how bobbins execute in the shell: trusted first-party code runs natively for performance; untrusted third-party code runs sandboxed for security.

---

## Problem Statement

Bobbinry needs to balance two competing concerns:

1. **Performance**: Core writing tools (Manuscript editor) must be blazingly fast with no overhead
2. **Security**: Community/marketplace extensions must be isolated to protect user data

Running all bobbins in sandboxed iframes adds significant overhead:
- postMessage serialization/deserialization on every interaction
- Separate rendering contexts (DOM, styles, layout)
- No server-side rendering (SSR) for initial load optimization
- No direct access to React context or shell optimizations

But running all bobbins natively would create security risks for untrusted code.

---

## Solution: Two Execution Modes

### Native Execution (First-Party Only)

**Definition:** Trusted bobbins that ship with the core platform, loaded as direct React components.

**Characteristics:**
- Bobbins live in the `bobbins/` workspace as npm packages
- Imported directly into shell via dynamic `import()`
- Full access to shell APIs, React context, and state management
- Can be server-side rendered by Next.js
- Code-reviewed and cryptographically signed
- Examples: Manuscript, Corkboard

**Performance Benefits:**
- No iframe overhead (no separate DOM/style recalc)
- No postMessage serialization
- Shared code splitting and tree shaking
- Direct browser API access (TipTap, IndexedDB)
- SSR for faster first paint

**Manifest Declaration:**
```yaml
id: manuscript
execution:
  mode: native
  signature: <ed25519-signature>  # Verified at install
```

**View Registry:**
```typescript
{
  viewId: "manuscript.editor",
  bobbinId: "manuscript",
  execution: "native",
  component: () => import('@bobbins/manuscript/views/Editor'),
  ssr: true
}
```

**Shell Loader:**
```typescript
// apps/shell/src/lib/view-loader.ts
async function loadNativeView(viewId: string) {
  const entry = viewRegistry.get(viewId);
  if (entry.execution !== 'native') throw new Error('Not a native view');
  
  // Verify signature before loading
  await verifySignature(entry.bobbinId, entry.signature);
  
  // Direct React component import
  const { default: Component } = await entry.component();
  return Component;
}
```

---

### Sandboxed Execution (Third-Party Default)

**Definition:** Untrusted bobbins from community/marketplace, loaded in isolated iframes.

**Characteristics:**
- Distributed as standalone bundles (not in workspace)
- Run in iframe with strict `sandbox` attributes
- Communication via postMessage (View SDK bridge)
- Limited to declared capabilities from manifest
- Client-side only (no SSR)
- Examples: Dictionary Panel, community extensions

**Security Benefits:**
- Complete DOM isolation
- No direct access to shell internals
- Strict CSP prevents network access by default
- Revocable permissions
- Kill-switch per bobbin

**Manifest Declaration:**
```yaml
id: dictionary-panel
execution:
  mode: sandboxed  # Default, can be omitted
capabilities:
  - pubsub.consume: manuscript.editor.selection.v1
```

**View Registry:**
```typescript
{
  viewId: "dictionary-panel.inspector",
  bobbinId: "dictionary-panel",
  execution: "sandboxed",
  iframeSrc: "/view-sandbox/dictionary-panel",
  capabilities: ["pubsub.consume"],
  ssr: false
}
```

**Shell Loader:**
```typescript
// apps/shell/src/lib/view-loader.ts
function loadSandboxedView(viewId: string) {
  const entry = viewRegistry.get(viewId);
  if (entry.execution !== 'sandboxed') throw new Error('Not a sandboxed view');
  
  // Render iframe with strict sandbox
  return (
    <iframe
      src={entry.iframeSrc}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      // CSP enforced via HTTP headers
    />
  );
}
```

**View SDK Bridge:**
```typescript
// packages/view-sdk/src/index.ts
export const ViewSDK = {
  subscribe(topic: string, handler: (data: unknown) => void) {
    window.parent.postMessage({
      type: 'sdk:subscribe',
      topic
    }, '*');
    
    window.addEventListener('message', (e) => {
      if (e.data.type === 'leb:publish' && e.data.topic === topic) {
        handler(e.data.payload);
      }
    });
  }
};
```

---

## Decision Matrix

| Aspect | Native | Sandboxed |
|--------|--------|-----------|
| **Performance** | Full speed (no overhead) | postMessage latency |
| **SSR** | ✅ Yes | ❌ No |
| **Code Splitting** | ✅ Shared with shell | ❌ Separate bundle |
| **React Context** | ✅ Direct access | ❌ Via SDK only |
| **Security** | Code review + signature | iframe isolation |
| **Distribution** | Ships with platform | Marketplace bundles |
| **Who Can Publish** | Platform maintainers only | Anyone (with review) |
| **Use Case** | Core workflows (editor) | Auxiliary tools (panels) |

---

## Security Model

### Native Bobbin Requirements
1. **Code Review**: Manual review by platform maintainers
2. **Signature**: Ed25519 signature from platform signing key
3. **Workspace Location**: Must be in `bobbins/` monorepo workspace
4. **Open Source**: Source code visible in platform repo
5. **Audit Trail**: Git history provides provenance

### Sandboxed Bobbin Requirements
1. **Manifest Validation**: JSON schema validation + capability checks
2. **Sandbox Isolation**: iframe with restrictive sandbox attributes
3. **Permission Prompts**: User approval for each capability
4. **CSP**: Strict Content Security Policy (no network by default)
5. **Kill Switch**: Can be disabled per-project or globally

### Native Bobbin Installation Flow
```
1. User installs Manuscript (or ships pre-installed)
2. Shell verifies signature against platform public key
3. If valid, registers in view registry with execution: "native"
4. Shell can now import() the component directly
```

### Sandboxed Bobbin Installation Flow
```
1. User browses marketplace, selects Dictionary Panel
2. Shell downloads manifest + bundle
3. Displays permission prompt for declared capabilities
4. User approves → bundle stored in sandbox directory
5. Registered in view registry with execution: "sandboxed"
6. Shell loads in iframe on activation
```

---

## Implementation Phases

### Phase 1 (MVP)
- [x] Native loader for Manuscript + Corkboard (workspace imports)
- [x] View registry distinguishes execution modes
- [ ] Signature verification stub (disabled in dev)
- [ ] Sandboxed loader with postMessage bridge
- [ ] Dictionary Panel as example sandboxed bobbin

### Phase 2 (Marketplace)
- [ ] Signature generation/verification in production
- [ ] Marketplace bundle upload + validation
- [ ] Permission UI for sandboxed bobbin capabilities
- [ ] CSP enforcement for external network access
- [ ] Provenance logging for all bobbin actions

### Phase 3 (Advanced)
- [ ] Native bobbin promotion path (trusted third-party → signed → native)
- [ ] Web Workers for CPU-intensive sandboxed operations
- [ ] Sandboxed bobbin performance monitoring
- [ ] Auto-revoke permissions on suspicious behavior

---

## Precedents

This model is inspired by:

1. **VS Code**: Core editor is native; extensions run in isolated Node processes
2. **Figma**: Core is native WASM; plugins run in sandboxed iframes
3. **Browser Extensions**: Chrome/Firefox use separate execution contexts with message passing
4. **Notion**: Core blocks are native; integrations are sandboxed

---

## FAQ

**Q: Can a sandboxed bobbin be "promoted" to native?**  
A: Not automatically. It requires platform team review, signing, and inclusion in the core workspace. This is intentionally a high bar.

**Q: What about performance-critical third-party bobbins?**  
A: They must remain sandboxed unless adopted as official first-party bobbins through the promotion path.

**Q: Can native bobbins be distributed separately?**  
A: No. Native bobbins only ship with the platform or via signed platform updates. This prevents signature forgery.

**Q: How does SSR work with native bobbins?**  
A: Next.js can import and render native bobbin components during SSR. The view registry marks SSR-capable views. Sandboxed bobbins are client-only.

**Q: What prevents a malicious marketplace bobbin from stealing data?**  
A: Iframe sandbox + CSP prevent network access. All data access is mediated through the View SDK, which enforces manifest-declared capabilities and user permissions.

---

**Decision Ratified:** 2025-09-29  
**Next Review:** After Phase 1 implementation