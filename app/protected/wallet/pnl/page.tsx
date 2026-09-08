import WalletPnlPanel from '@/components/wallet/pnl/wallet-pnl-panel'

export default function Page() {
  return (
    <div className="flex-1 w-full flex flex-col gap-6 p-4">
      <h1 className="text-2xl text-black font-bold">Wallet PnL</h1>
      <WalletPnlPanel />
    </div>
  )
}
