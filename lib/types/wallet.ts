// types/wallet.ts — matches exactly what get_wallets() returns

export interface WalletRecord {
  id:               string        // private.wallets.id
  user_id:          string
  public_key:       string
  label:            string | null
  chain:            string
  is_active:        boolean
  created_at:       string

  // Ownership
  owner_record_id:  string | null
  role:             'sole' | 'primary' | 'co-owner' | 'view-only' | null

  // Type — both returned
  wallet_type_id:   string | null  // ← UUID for filtering
  wallet_type:      string | null  // ← name for display

  // Group — both returned
  wallet_group_id:  string | null  // ← UUID for filtering
  group_name:       string | null  // ← name for display
  group_color:      string | null  // ← hex for display
}