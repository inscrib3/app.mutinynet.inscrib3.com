# Inscrib3 App

**Native liquidity. Built on Bitcoin.**

An open-source interface for permissionless swaps, liquidity, and asset creation on
[Arkade](https://arkadeos.com). Native BTC stays native: there is no wrapped Bitcoin, bridge, or
custodial deposit account.

> **Experimental.** The current public release runs on Mutinynet. This application and its
> contracts are early software: use test funds and review every wallet approval. A deployment is
> configured for exactly one network and must never mix Mutinynet and mainnet services.

## Links

- App: [app.mutinynet.inscrib3.com](https://app.mutinynet.inscrib3.com)
- Inscrib3: [inscrib3.com](https://inscrib3.com)
- Documentation: [docs.inscrib3.com](https://docs.inscrib3.com)
- Wallet: [wallet.inscrib3.com](https://wallet.inscrib3.com)
- Wallet source: [inscrib3/arkade-wallet](https://github.com/inscrib3/arkade-wallet)
- Arkade AMM reference: [docs.arkadeos.com](https://docs.arkadeos.com/vaults/reference/automated-market-maker)

## What you can do

- swap native BTC and Arkade assets through covenant-enforced constant-product pools;
- swap two Arkade assets without wrapping either side;
- request exact-input or exact-output quotes with integer-exact arithmetic;
- add liquidity at the current pool ratio and receive LP assets;
- remove liquidity by redeeming LP assets;
- search pools and assets through the indexed API;
- share compact links that open a specific pool, direction, and optional amount;
- issue an Arkade asset directly from Inscrib3 Wallet;
- create a permissionless pool from the browser;
- inspect reserves, fees, recent activity, and controlled-supply warnings.

The busiest available pool can receive an **On fire** badge after at least three settled operations
in a rolling 24-hour window. Closed historical pools are never promoted.

## How custody works

The app uses the immutable `window.arkade` provider injected by the
[Inscrib3 Wallet browser extension](https://chromewebstore.google.com/detail/hafphignbjdmblopkophkohgnphalclg).
Private keys remain inside the wallet. Sensitive operations open a wallet approval screen before
anything is signed.

The hosted web wallet is useful for regular wallet operations, but it does not expose the full
provider API required by this AMM. Install the browser extension to swap, manage liquidity, issue
assets, or create pools from the app.

For swaps and liquidity updates, the wallet funds a request-specific covenant that commits to the
user's payout and minimum terms. The coordinator verifies funding and batches compatible requests;
it does not receive a user seed or gain the ability to redirect the committed payout.

Learn more about the provider:

- [`window.arkade` overview](https://docs.inscrib3.com/provider/overview)
- [Provider methods](https://docs.inscrib3.com/provider/methods)
- [Events and errors](https://docs.inscrib3.com/provider/events-errors)
- [Wallet security](https://docs.inscrib3.com/wallet/security)

## Pool economics

Permissionless pools default to a **1.00% total swap fee**:

- **0.70%** remains in the pool for liquidity providers;
- **0.30%** accrues to the stable protocol Treasury Vault.

Creating a pool costs **10,000 sats** on Mutinynet. The fee, initial liquidity, and technical carriers
are funded together in one atomic bootstrap payment. The initial reserve ratio establishes the initial
price; reserve depth determines how quickly price moves as users trade.

Assets with a `controlAssetId` are reissuable by the control holder. The interface displays a
warning because future issuance can affect the economics of a pool. A warning is information, not
an endorsement or risk rating.

## Requirements

- Node.js 22 or later;
- npm;
- a compatible Arkade AMM coordinator API running locally;
- Inscrib3 Wallet configured for the same network as the app.

Install dependencies and start Vite:

```bash
npm install
cp .env.example .env
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). In development, Vite proxies `/api` to
`http://127.0.0.1:3210`.

To use a remote coordinator instead, set:

```env
VITE_API_URL=https://api.example.com
VITE_NETWORK=mutinynet
VITE_APP_URL=https://app.example.com
```

`VITE_NETWORK` accepts `mutinynet` or `mainnet`. The app verifies both the API deployment and the
connected Inscrib3 Wallet before allowing a transaction. The API must allow the app's exact origin
through CORS.

## Scripts

```bash
npm run dev       # local development server
npm run build     # TypeScript check and production build
npm run lint      # oxlint
npm run preview   # serve the production build locally
```

## Shared swap links

The query string can identify a pool, direction, and optional amount:

```text
?swap=pool-id
?swap=pool-id&side=quote
?swap=pool-id&amount=0.001
?swap=pool-id&side=quote&output=100
```

- `swap` is the pool ID;
- `side=quote` selects the quote asset as the payment side;
- `amount` prefills exact input;
- `output` prefills exact output.

## Deployment

One build serves one network. Configure these GitHub repository variables before deploying:

| Variable | Mutinynet | Mainnet |
|---|---|---|
| `VITE_NETWORK` | `mutinynet` | `mainnet` |
| `VITE_API_URL` | `https://api.mutinynet.inscrib3.com` | URL of the mainnet API |
| `VITE_APP_URL` | `https://app.mutinynet.inscrib3.com` | `https://app.inscrib3.com` |

Pushes to `main` run `.github/workflows/deploy-pages.yml` and publish that single configured build
through GitHub Pages. The app does not contain a hardcoded custom domain.

Repository settings:

1. select **GitHub Actions** under **Settings → Pages**;
2. configure `app.mutinynet.inscrib3.com` for Mutinynet or `app.inscrib3.com` for mainnet;
3. point its DNS CNAME to the repository owner's `<owner>.github.io` host;
4. enable **Enforce HTTPS** after GitHub issues the certificate.

The configured coordinator must run on the same network as the app. The app verifies this through
`/health` and also checks the active Inscrib3 Wallet network before requesting a transaction.

## Contributing and security

Issues and pull requests are welcome. Run both `npm run build` and `npm run lint` before opening a pull request.

Security problems can put user funds at risk. Please use the repository's private vulnerability
reporting instead of opening a public issue. If private reporting is unavailable, contact
[inscrib3@proton.me](mailto:inscrib3@proton.me).

Inscrib3 is an independent team building useful, accessible, open-source products on Bitcoin. See
[github.com/inscrib3](https://github.com/inscrib3) and follow
[@inscrib3](https://x.com/inscrib3).

## License

[MIT](LICENSE) — Copyright © 2026 Inscrib3.
