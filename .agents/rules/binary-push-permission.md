---
name: binary-push-permission
description: Strict binary and OTA release push protocol. Never push or ship binaries to remote endpoints without explicit user permission.
---

# Binary Push & Release Permission Rule

## 🛑 MANDATORY: NEVER PUSH OR SHIP BINARIES WITHOUT EXPLICIT PERMISSION
All AI agents, background tasks, automation tools, and scripts MUST NEVER execute `npm run ship`, compile/publish OTA release binaries, or upload installers to GPHost, Cloudflare R2, or any remote distribution endpoint without explicit, unambiguous permission from the user in the current conversation.

### Rules & Protocols:
1. **Explicit Instruction Required:** Even if local code modifications, bug fixes, or performance enhancements are tested, verified, and 100% complete, keep all changes **STRICTLY LOCAL**. Do NOT execute `node scripts/ship.mjs`, `npm run ship`, or upload release files unless the user explicitly commands: *"push binary"*, *"ship binary"*, or *"publish release <version>"*.
2. **Never Auto-Ship on Bug Fixes:** Never assume that diagnosing and fixing a bug entitles the agent to push a live binary to production users. Always ask or wait for the user to explicitly greenlight the binary release.
3. **Sequential Semver Compliance:** When authorized to ship, strictly adhere to monotonic sequential patch versioning (e.g., `0.0.0` base, `0.0.1`, `0.0.2`, `0.0.3`...).
4. **Storage Hygiene:** Ensure only the immutable base installer (`0.0.0`), the latest companion extension, and the single authorized active target release reside on GPHost.
