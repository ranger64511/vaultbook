# Vault Book

**A private, self-hosted personal finance tracker that runs entirely on your own computer.**

Import your bank and credit card statements and Vault Book will break out every transaction by month and week, show how much you owe on each card, find recurring charges you might cancel, help you build a needs-vs-wants budget, and lay out a plan to pay your credit cards down to $0.

![License: MIT](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%E2%89%A522.13-green)
![React](https://img.shields.io/badge/react-19-61dafb)
![Status: as-is](https://img.shields.io/badge/support-none%20(as--is)-lightgrey)

> [!IMPORTANT]
> **Provided as-is, with no support.** This is a personal project shared in case it's useful to others. Issues and pull requests may not be answered. See [Disclaimer](#disclaimer).

> [!NOTE]
> Built with the assistance of [Claude](https://www.anthropic.com/claude), Anthropic's AI assistant.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Using Vault Book](#using-vault-book)
- [Security & privacy](#security--privacy)
- [Supported statement formats](#supported-statement-formats)
- [Development](#development)
- [Project structure](#project-structure)
- [Backup & restore](#backup--restore)
- [Troubleshooting](#troubleshooting)
- [Disclaimer](#disclaimer)
- [License](#license)

---

## Features

| Area | What it does |
|---|---|
| **Statement import** | CSV, OFX/QFX, and PDF. Columns are auto-detected, rows are previewed before saving, duplicates are skipped, and any import can be undone. Credit card PDFs also fill in balance, minimum payment, APR, credit limit, and due date. |
| **Transactions** | Search, filter by account, category, or month, and group by **month** or **week** with money-in and money-out totals. Re-categorize a transaction and Vault Book can remember the merchant for next time. |
| **Dashboard** | Total card debt and utilization, 12-month income vs. spending, weekly needs vs. wants, top spending categories, and recent activity. |
| **Recurring charges** | Finds subscriptions and bills that repeat weekly, monthly, quarterly, or yearly. Shows yearly cost, flags price increases, and lets you mark each one *Cancel* or *Keep* to total up your savings. |
| **Budget** | Monthly budgets per category, each marked **Need** or **Want**. One click suggests amounts from your 3-month averages, and spending is compared with the 50/30/20 guideline. |
| **Debt payoff plan** | **Avalanche** (highest APR first) vs. **Snowball** (smallest balance first). Shows your debt-free date, total interest, interest saved vs. paying only minimums, a month-by-month payment schedule, and "speed it up" scenarios. |
| **Appearance** | Modern responsive UI with Light, Dark, and Auto (follows your OS) themes. |

## Requirements

- [Node.js](https://nodejs.org/) **22.13 or newer** (includes npm)
- A modern browser (Chrome, Edge, Firefox, or Safari)
- Windows, macOS, or Linux

## Quick start

```bash
git clone https://github.com/ranger64511/vaultbook.git
cd vaultbook
npm install
npm run build
npm start
```

Then open **http://localhost:4310**.

On Windows you can instead double-click **`Start Vault Book.bat`**, which installs, builds, starts, and opens the app.

On first launch you'll create a username and password.

> [!WARNING]
> **There is no password reset.** Your password is the key that decrypts your data. If you lose it, your data cannot be recovered. Keep it in a password manager and download a backup regularly.

## Using Vault Book

1. **Add your accounts.** Go to *Accounts & cards* and add each checking, savings, and credit card account. For cards, include the APR and minimum payment so the payoff plan is accurate.
2. **Import statements.** Go to *Import statements*, pick the account, and drop in a file. Review the preview, then click **Import**. Importing 2–3 months or more makes recurring-charge detection work well.
3. **Clean up categories.** Fix any miscategorized transactions on the *Transactions* page. Vault Book offers to remember the merchant.
4. **Review recurring charges.** Mark subscriptions you want to drop as *Cancel*. Vault Book totals the monthly and yearly savings.
5. **Set a budget.** On *Budget*, click **Suggest from history**, adjust, and **Save**. Use **+ Category** to add your own categories.
6. **Plan your payoff.** On *Debt payoff plan*, set how much you can put toward cards each month and compare strategies.

### Try it with demo data

To explore Vault Book without your own statements, run the sandbox. It stores data separately in `data-demo/`.

```bash
npm run dev:demo
```

In a second terminal, load the fake sample statements:

```bash
node samples/seed-demo.js
```

Open **http://localhost:5173** and sign in with the demo login in [`samples/DEMO_LOGIN.md`](samples/DEMO_LOGIN.md).

## Security & privacy

Vault Book is designed so that your financial data never leaves your computer and is never stored unencrypted.

| Protection | Details |
|---|---|
| **Encryption at rest** | All data lives in one file, `data/vault.enc`, encrypted with **AES-256-GCM**. |
| **Password-derived key** | A random data key is wrapped with a key derived from your password using **scrypt** (N=2¹⁷, r=8, p=1). Only the wrapped key is stored, in `data/auth.json`. |
| **Key only in memory** | The decrypted key exists only in server memory while you're signed in. It's wiped on sign-out, after 30 minutes idle, or after 12 hours at most. |
| **Local only** | The server binds to `127.0.0.1`, so it's unreachable from other devices. Requests addressed to other hostnames are rejected (DNS-rebinding protection). |
| **Uploads** | Statements are parsed in memory and never written to disk. |
| **Web hardening** | httpOnly + SameSite=Strict session cookies, a CSRF header on every change, login lockout after repeated failures, and a strict Content-Security-Policy (via [helmet](https://helmetjs.github.io/)). |

See [SECURITY.md](SECURITY.md) for the threat model and its limits.

> [!CAUTION]
> Never commit the `data/` folder or a backup file. Both are excluded in `.gitignore` by default.

## Supported statement formats

| Format | Reliability | Notes |
|---|---|---|
| **CSV** | ★★★ | Column auto-detection handles most banks: single amount column, separate debit/credit columns, and files with header rows on top. |
| **OFX / QFX / QBO** | ★★★ | The "Quicken" or "Money" download most banks offer. Very consistent. |
| **PDF** | ★★☆ | Best effort for text-based statements. Scanned (image) PDFs can't be read. Always check the preview. |

**Where to find these files:** in your bank's website, open an account's activity page and look for **Download** or **Export transactions**.

**Signs:** Vault Book shows money out as negative and money in as positive. Card exports that list charges as positive are detected and flipped automatically. If a file still comes in backwards, use **Flip signs** in the preview.

## Development

```bash
npm install
npm run dev        # API + Vite dev server with hot reload → http://localhost:5173
npm test           # unit tests (parsers, categorization, recurring detection, payoff math)
npm run build      # production build → client/dist
npm start          # serve the built app → http://localhost:4310
```

| Script | Purpose |
|---|---|
| `npm run dev` | Development mode using your real `data/` vault |
| `npm run dev:demo` | Development mode using the separate `data-demo/` sandbox |
| `npm run samples` | Regenerate the fake sample CSV files |
| `npm test` | Run the test suite with Node's built-in test runner |

**Environment variables (optional):**

| Variable | Default | Purpose |
|---|---|---|
| `VAULTBOOK_PORT` | `4310` | API / app port |
| `VAULTBOOK_DATA_DIR` | `./data` | Where the encrypted vault is stored |

**Tech stack:** React 19, React Router, Recharts, Lucide icons, Vite · Node.js, Express 5, helmet, multer, PapaParse, pdf.js.

## Project structure

```
├── client/                 React front end (Vite root)
│   ├── public/             Static assets (favicon, theme bootstrap script)
│   └── src/
│       ├── pages/          Dashboard, Transactions, Import, Accounts, Recurring, Budget, Payoff, Settings
│       ├── components/     Shared UI (cards, modal, charts, theme toggle)
│       └── lib/            Formatting, theming, analytics (recurring detection + payoff simulation)
├── server/
│   ├── index.js            Express API, sessions, security middleware
│   ├── vault.js            Encryption: scrypt key derivation, AES-256-GCM vault
│   ├── categorize.js       Default categories, keyword rules, merchant normalization
│   └── parsers/            CSV, OFX/QFX, and PDF statement parsers
├── samples/                Fake sample statements and demo seed script
├── data/                   Your encrypted vault (git-ignored, created on first run)
└── Start Vault Book.bat        One-click launcher for Windows
```

## Backup & restore

- **Encrypted backup:** *Settings → Download encrypted backup*. This gives you a JSON file containing your encrypted vault and wrapped key. You still need your password to use it.
- **Restore:** stop Vault Book. From the backup file, write the `auth` object to `data/auth.json` and base64-decode `vault` into `data/vault.enc`. Then start Vault Book and sign in.
- **CSV export:** *Transactions → Export CSV*. This file is **not encrypted**, so store it carefully.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not find date / description / amount columns" | The CSV layout isn't recognized. Try your bank's OFX/QFX download instead. |
| PDF shows "no readable text" | It's a scanned image. Download a CSV or OFX export instead. |
| Amounts are backwards | Click **Flip signs** in the import preview, or flip a single row by clicking its amount. |
| Signed out unexpectedly | Vault Book locks after 30 minutes idle and whenever the server restarts. Sign in again. |
| Port already in use | Start with another port, e.g. `VAULTBOOK_PORT=4400 npm start`. |
| Forgot password | Not recoverable by design. Delete `data/` to start over. **This erases all data.** |

## Disclaimer

- This software is provided **"as is", without warranty of any kind**, and **without support**. Use it at your own risk.
- Vault Book is a personal budgeting and planning tool. It is **not financial, tax, or legal advice**. Payoff projections are estimates that assume no new charges, fixed APRs, and fixed minimum payments.
- Vault Book is not affiliated with any bank or card issuer. Bank and merchant names appear only in categorization rules and fictional sample data.
- Built with the assistance of Claude (Anthropic). Review the code yourself before trusting it with sensitive data.

## License

Released under the [MIT License](LICENSE).
