# Relay Server — Integration Reference

How to connect to this relay from another local service: REST calls for managing watch lists, the WebSocket protocol for receiving live events, and the exact shape of every message.

Base URL defaults to `http://localhost:3099` (set via the `PORT` env var on this server). All examples below assume that default — adjust the host/port to match your deployment.

No authentication on any endpoint. Everything here — REST and WebSocket — is intended for trusted local callers only, not the public internet.

## 1. Connecting

| Transport | URL |
|---|---|
| REST (control plane) | `http://localhost:3099` |
| WebSocket (event feed) | `ws://localhost:3099/ws` |

```js
const ws = new WebSocket('ws://localhost:3099/ws');
```

On connect, before anything live, the server sends (in order):
1. One `status` message — current snapshot.
2. Up to the last 50 `token-launch` events.
3. Up to the last 50 `token-transaction` events (from currently/previously watched mints).
4. Up to the last 50 `wallet-transaction` events (from currently/previously watched wallets).

After that backfill, you receive events live as they happen, plus a periodic `status` every 10s and a `heartbeat` every 15s (heartbeats exist purely to keep the socket alive through proxies — no payload to act on).

There's no message replay beyond that 50-deep buffer. If your client disconnects for longer than it takes for >50 events of a given type to occur, you will miss some — reconnect promptly and don't rely on this feed as a durable log.

### Reconnect handling

This relay does not push a "you've been disconnected, here's what you missed" message. Implement your own reconnect-with-backoff on the client side:

```js
function connect() {
  const ws = new WebSocket('ws://localhost:3099/ws');
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  return ws;
}
```

## 2. WebSocket Message Types

Every message is JSON with a `type` discriminator. Switch on it.

### `token-launch`

Emitted when PumpFun's API surfaces a new token (polled every 5s upstream). This is a **one-time snapshot** at first detection — fields like `marketCapSol` are not refreshed afterward.

```json
{
  "type": "token-launch",
  "signature": "5xYz...",
  "time": "2026-06-18T12:00:00.000Z",
  "name": "MoonCat",
  "symbol": "MCAT",
  "metadataUri": "https://...",
  "mint": "ABC123...pump",
  "creator": "9xYz...abc",
  "isV2": true,
  "hasGithub": true,
  "githubUrls": ["https://github.com/mooncat/contracts"],
  "imageUri": "https://...",
  "description": "The first cat on the moon",
  "marketCapSol": 28.5,
  "website": "https://mooncat.io",
  "twitter": "https://twitter.com/mooncat",
  "telegram": "https://t.me/mooncat"
}
```

| Field | Type | Notes |
|---|---|---|
| `signature` | `string` | Tx signature, or the mint address if unavailable |
| `time` | `string` | ISO 8601 |
| `name`, `symbol`, `mint`, `creator`, `metadataUri`, `imageUri`, `description`, `website`, `twitter`, `telegram` | `string \| null` | Direct from PumpFun's API |
| `isV2` | `boolean` | |
| `hasGithub` | `boolean` | Whether a GitHub URL was found anywhere in the coin's metadata |
| `githubUrls` | `string[]` | Extracted via regex from description/website/twitter/telegram/metadata |
| `marketCapSol` | `number \| null` | One-time snapshot at detection time, **not live** |

### `token-transaction`

Emitted for a transaction touching a mint you're watching (see [§3 Watching Mints](#watching-mints)). Requires the mint to be confirmed-subscribed first — see that section for the timing guarantee.

```json
{
  "type": "token-transaction",
  "signature": "4usy38y3...",
  "slot": 427374187,
  "timestamp": 1781819910,
  "mint": "61V8vBaq...pump",
  "wallet": "DJ16xfMs...",
  "txType": "sell",
  "tokenAmount": -717.3,
  "solAmount": 0.839180282,
  "priceSol": 0.0011699153520145,
  "marketCapSol": 1169895.359
}
```

| Field | Type | Notes |
|---|---|---|
| `signature`, `slot`, `timestamp` | | `timestamp` is unix seconds |
| `mint` | `string` | The watched mint |
| `wallet` | `string` | The fee-payer / signer of the transaction |
| `txType` | `'buy' \| 'sell' \| 'transfer' \| 'unknown'` | See caveats below |
| `tokenAmount` | `number` | Signed change in the wallet's token balance (ui units) |
| `solAmount` | `number` | Signed change in the wallet's native SOL balance, fee-excluded |
| `priceSol` | `number \| null` | This fill's execution price (SOL per token) — **not a live spot price** |
| `marketCapSol` | `number \| null` | `priceSol × total supply` |

**Important caveats — `priceSol`/`marketCapSol` are `null`, and `txType` may read `'transfer'` instead of `'buy'`/`'sell'`, in these cases:**
- The trade settled in a token other than native SOL (e.g. a Jupiter-routed swap settling in USDC) — `solAmount` would just be fee-rounding noise, so price can't be derived from it.
- The transaction was a plain wallet-to-wallet SPL transfer with no compensating SOL/token payment — without this check it would otherwise look like "sold at price 0," which is wrong; it's reclassified as `'transfer'`.
- `tokenAmount` is `0` (nothing to price).

Treat `priceSol: null` as "unknown," never as zero. Validated empirically: for a genuine SOL-denominated trade, the computed `marketCapSol` matched PumpFun's own reported market cap for the same mint to within ~0.03%.

`wallet` is read as the transaction's fee-payer (account index 0). If a sponsor/relayer pays fees on behalf of the actual trader, this attribution will be wrong for that tx — this only affects the rare sponsored-transaction case, not normal wallet-initiated trades.

### `wallet-transaction`

Emitted for any transaction that changes the SOL or token balance of a wallet you're watching (see [§4 Watching Wallets](#watching-wallets)). Unlike `token-transaction`, there's no buy/sell classification — a wallet isn't tied to one asset.

```json
{
  "type": "wallet-transaction",
  "signature": "2pDhSybd...",
  "slot": 427373665,
  "timestamp": 1781819702,
  "wallet": "7rhxnLV8...",
  "isFeePayer": true,
  "solAmount": -0.05,
  "tokenChanges": [
    { "mint": "61V8vBaq...pump", "amount": 1500.25 }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `signature`, `slot`, `timestamp` | | `timestamp` is unix seconds |
| `wallet` | `string` | The watched wallet |
| `isFeePayer` | `boolean` | Whether this wallet paid the tx fee (account index 0) |
| `solAmount` | `number` | Signed SOL balance change; fee-excluded only when `isFeePayer` is true |
| `tokenChanges` | `{ mint: string; amount: number }[]` | One entry per SPL mint whose balance changed for this wallet, ui units, signed |

Events where nothing actually changed for the wallet (`solAmount === 0` and `tokenChanges` empty) are suppressed — you will never see a no-op event.

### `status`

```json
{
  "type": "status",
  "connected": true,
  "uptime": 3600,
  "totalLaunches": 1234,
  "githubLaunches": 42,
  "clients": 7
}
```

| Field | Type | Notes |
|---|---|---|
| `connected` | `boolean` | Whether the PumpFun-launch data source is active (see `/health` for wallet/mint subscription connectivity specifically) |
| `uptime` | `number` | Server process uptime, seconds |
| `totalLaunches` | `number` | Cumulative token launches observed |
| `githubLaunches` | `number` | Of those, how many had a GitHub URL |
| `clients` | `number` | Currently connected WebSocket clients |

### `heartbeat`

```json
{ "type": "heartbeat", "ts": 1781819910000 }
```

No action needed beyond noting the connection is alive.

## 3. Watching Mints

Watching a mint subscribes to its on-chain activity live — no historical backfill. If you know a mint address before its creation transaction lands (e.g. a pre-generated vanity address), watch it first and the creation tx itself will be caught as the first `token-transaction` event.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/tokens/watched` | — | `{ "mints": string[] }` |
| `POST` | `/tokens/watch` | `{ "mint": "<base58 address>" }` | `{ "mints": string[] }` |
| `POST` | `/tokens/unwatch` | `{ "mint": "<base58 address>" }` | `{ "mints": string[] }` |

**`POST /tokens/watch` blocks until the RPC node confirms the subscription is live.** A `200` response is a real guarantee — if your flow needs to broadcast an on-chain transaction immediately after subscribing (e.g. launching the token), it's safe to do so only after this call resolves, not before.

Error responses:
- `400 { "error": "mint must be a valid base58 Solana address" }` — bad input.
- `504 { "error": "..." }` — the upstream Solana WebSocket isn't connected, or the RPC node didn't confirm in time (5s default). Retry, or check `/health`'s `solana` field first.

```bash
curl -X POST http://localhost:3099/tokens/watch \
  -H "Content-Type: application/json" \
  -d '{"mint":"61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump"}'
# => {"mints":["61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump"]}

curl http://localhost:3099/tokens/watched
# => {"mints":["61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump"]}

curl -X POST http://localhost:3099/tokens/unwatch \
  -H "Content-Type: application/json" \
  -d '{"mint":"61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump"}'
# => {"mints":[]}
```

An initial watch list can also be set at server startup via the `WATCH_MINTS` env var (comma-separated addresses) — useful for mints you always want watched regardless of which client connects.

## 4. Watching Wallets

Identical contract to mints, under `/wallets/*`:

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/wallets/watched` | — | `{ "wallets": string[] }` |
| `POST` | `/wallets/watch` | `{ "wallet": "<base58 address>" }` | `{ "wallets": string[] }` |
| `POST` | `/wallets/unwatch` | `{ "wallet": "<base58 address>" }` | `{ "wallets": string[] }` |

Same blocking-until-confirmed semantics on `/wallets/watch`, same `400`/`504` error shapes. Initial list via the `WATCH_WALLETS` env var (comma-separated).

```bash
curl -X POST http://localhost:3099/wallets/watch \
  -H "Content-Type: application/json" \
  -d '{"wallet":"9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"}'
```

## 5. Health Check

```bash
curl http://localhost:3099/health
```

```json
{
  "status": "ok",
  "solana": true,
  "wallets": true,
  "clients": 3,
  "totalLaunches": 567,
  "totalWalletTxs": 12,
  "uptime": 7200.5
}
```

| Field | Meaning |
|---|---|
| `solana` | Is the mint-watching / token-launch upstream WebSocket connected |
| `wallets` | Is the wallet-watching upstream WebSocket connected |
| `clients` | Connected WebSocket clients on `/ws` |
| `totalLaunches` | Cumulative token launches observed |
| `totalWalletTxs` | Cumulative watched-wallet transactions processed |
| `uptime` | Seconds |

Poll this before calling `/tokens/watch` if you need to confirm the upstream connection is up first (a `504` from `/tokens/watch` usually means `solana: false` here).

## 6. Reference Client (Node.js)

Minimal wrapper combining REST control calls with the WebSocket feed — adapt as needed.

```js
import WebSocket from 'ws';

class RelayClient {
  constructor(baseUrl = 'http://localhost:3099') {
    this.baseUrl = baseUrl;
    this.wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
    this.handlers = {};
    this._connect();
  }

  on(type, fn) {
    (this.handlers[type] ??= []).push(fn);
    return this;
  }

  _connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      for (const fn of this.handlers[msg.type] ?? []) fn(msg);
    });
    this.ws.on('close', () => setTimeout(() => this._connect(), 2000));
    this.ws.on('error', () => this.ws.close());
  }

  async _post(path, body) {
    const res = await fetch(this.baseUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
    return json;
  }

  // Resolves once the subscription is confirmed live — safe to act on afterward.
  watchMint(mint) { return this._post('/tokens/watch', { mint }); }
  unwatchMint(mint) { return this._post('/tokens/unwatch', { mint }); }
  watchWallet(wallet) { return this._post('/wallets/watch', { wallet }); }
  unwatchWallet(wallet) { return this._post('/wallets/unwatch', { wallet }); }
}

// Usage:
const relay = new RelayClient('http://localhost:3099');

relay.on('token-transaction', (e) => {
  if (e.priceSol === null) return; // unknown price — see §2 caveats
  console.log(`${e.txType} ${Math.abs(e.tokenAmount)} of ${e.mint} @ ${e.priceSol} SOL (mcap ${e.marketCapSol})`);
});

relay.on('wallet-transaction', (e) => {
  console.log(`${e.wallet} sol=${e.solAmount}`, e.tokenChanges);
});

await relay.watchMint('61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump');
// Safe to broadcast the on-chain tx for this mint now — subscription is confirmed live.
```

## 7. Relevant Server Configuration

Set on the relay server itself (not callable remotely) — listed here since they affect what you'll see on the feed:

| Env var | Default | Effect |
|---|---|---|
| `PORT` | `3099` | HTTP/WebSocket listen port |
| `SOLANA_RPC_WS` | `wss://api.mainnet-beta.solana.com` | Upstream Solana RPC WebSocket (use a paid RPC — the public endpoint silently drops `logsSubscribe` notifications for high-traffic accounts) |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | Upstream Solana RPC HTTP, used for `getTransaction`/`getTokenSupply` |
| `WATCH_MINTS` | _(none)_ | Comma-separated mints watched at startup |
| `WATCH_WALLETS` | _(none)_ | Comma-separated wallets watched at startup |
