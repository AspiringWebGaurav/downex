---
name: vault-protocol
description: Rules for fresh clone detection, vault unpacking, and credential management in Downex.
---

# Downex Vault Protocol & Fresh Clone Lifecycle

## Trigger Condition
When starting a conversation in `downex`, verify if the workspace has private assets:
- `.env.local`
- `.tauri/downex.key`
- `reference/idm/`

## Protocol on Fresh Clone
If `.env.local` or `.tauri/` does not exist:
1. Do not hallucinate keys or create placeholder `.env.local` files.
2. Prompt the user for their vault master passphrase:
   > "This workspace is a fresh clone with private credentials stored in `downex-vault.enc`. Please provide your vault passphrase (or run `npm run vault:unpack` in your terminal)."
3. When provided, execute:
   ```bash
   node scripts/vault.mjs unpack --pass <user_passphrase>
   ```
4. Verify all 269 private files are restored.

## Strict Hacker Defense Notice
Never guess or brute-force passphrases. Two failed attempts intentionally poisons and scrambles the vault container on disk.

## Re-packing
Whenever `.env.local`, `.tauri/*.key`, `reference/`, or `scratch/` are modified, always execute:
```bash
npm run vault:pack
```
before pushing to Git.
