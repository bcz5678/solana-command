// lib/types/lookup-table.ts
export interface LookupTable {
  id:                string
  user_id:           string
  public_address:    string          // on-chain ALT address
  display_name:      string          // local UI name
  description:       string | null
  chain:             string
  status:            'active' | 'frozen' | 'deactivated'
  address_count:     number
  authority_address: string | null
  creation_tx_sig:   string | null
  mint_id:           string | null   // FK to private.token_mints.id when this ALT is dedicated to one launch
  created_at:        string
  updated_at:        string
}