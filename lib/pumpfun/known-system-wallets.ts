// Pump.fun protocol wallets that show up on-chain as ordinary buy/sell
// transactions but aren't real traders — the platform's own fee/authority
// accounts doing routine maintenance. Anything watching a mint's trade feed
// for "is this a real other trader" (front-run auto-halt, live-trade
// panels) should exclude these, or they read as a sniper/foreign trade.
export const KNOWN_PUMPFUN_SYSTEM_WALLETS: ReadonlySet<string> = new Set([
    // Pump.fun system authority / fee program — observed buying and selling
    // for protocol fee maintenance, not user activity.
    '5veTCy9eDaL66LqABfpywN6jr1s7zaXP4uit8sMRAaHA',
])

export function isKnownPumpfunSystemWallet(walletAddress: string): boolean {
    return KNOWN_PUMPFUN_SYSTEM_WALLETS.has(walletAddress)
}
