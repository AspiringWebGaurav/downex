---
name: git-push-permission
description: Strict Git push protocol. Never push to remote without explicit user permission.
---

# Git Push Permission Rule

## 🛑 MANDATORY: NEVER PUSH WITHOUT EXPLICIT PERMISSION
All AI agents, background tasks, automation tools, and scripts MUST NEVER execute `git push`, publish branches, or push tags to any remote repository without explicit, unambiguous permission from the user in the current conversation.

### Rules & Protocols:
1. **Explicit Confirmation Required:** Even if local commits are staged, prepared, or tested, do NOT execute `git push` unless the user explicitly gives a direct instruction (e.g., *"push to github"*, *"push now"*, or confirms an explicit request to push).
2. **Pre-Push Vault Check:** Ensure that any modified sensitive assets (`.env.local`, `.tauri/*.key`, `reference/`, `scratch/`) are safely packed into the encrypted vault (`npm run vault:pack`) before pushing.
3. **Zero Secrets in Git:** Never push unencrypted credentials, signing keys, or plain passphrases to Git.
