# Security

Vault Book is provided **as is, without support**. There is no security response process and no guarantee that reported issues will be fixed. If you find a problem, you're welcome to open an issue. Do **not** include any real financial data, statements, or vault files in it.

## What Vault Book protects against

| Threat | Mitigation |
|---|---|
| Someone copies your `data/` folder or a backup | The vault is AES-256-GCM encrypted. The key is wrapped with scrypt (N=2¹⁷) from your password. Without the password the data is unreadable. |
| Tampering with the vault file | GCM authentication detects any modification. A tampered vault fails to open. |
| Other devices on your network | The server listens only on `127.0.0.1`. |
| Malicious websites in your browser | SameSite=Strict cookies, a required CSRF header, Host-header allow-list (DNS rebinding), strict CSP, and `frame-ancestors 'none'`. |
| Password guessing | Expensive scrypt per attempt plus exponential lockout after 5 failures. |
| Leftover plaintext | Uploaded statements are parsed in memory only (OCR runs in the browser). Kept statement copies are encrypted with the vault key. The decrypted key is held in memory only while signed in. |

## What it does **not** protect against

- **Malware or another person using your logged-in computer.** While you're signed in, the data is decrypted in memory and accessible through the app.
- **A weak password.** Encryption is only as strong as your password. Use a long passphrase.
- **The plaintext CSV export.** *Export CSV* writes unencrypted data. Delete it when you're done.
- **Forgotten passwords.** There is no recovery by design.
- **Exposing the server to a network.** Don't change the bind address or put Vault Book behind a public proxy. It isn't designed or tested for that.

## Good practice

- Use a strong, unique password and keep it in a password manager.
- Download an encrypted backup regularly and keep it somewhere safe.
- Never commit `data/`, `data-demo/`, backup files, or real statements to git.
- Keep Node.js and dependencies up to date (`npm audit`, `npm update`).
