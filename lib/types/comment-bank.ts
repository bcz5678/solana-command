// lib/types/comment-bank.ts

export interface CommentBank {
  id:           string
  name:         string
  description:  string | null
  /** null = generic (usable for any token). Set = only offered for this mint. */
  mint_address: string | null
  entry_count:  number
  created_at:   string
}

export interface CommentBankEntry {
  id:           string
  bank_id:      string
  text:         string
  source:       string
  is_active:    boolean
  used_count:   number
  last_used_at: string | null
  created_at:   string
}

export interface CommentScheduleEntry {
  id:              string
  wallet_id:       string
  mint_address:    string
  status:          'pending' | 'processing' | 'posted' | 'skipped' | 'failed'
  scheduled_for:   string
  posted_at:       string | null
  comment_bank_id: string | null
  /** The exact text posted — joined from the claimed comment_bank entry. Null until status reaches 'posted'. */
  comment_text:    string | null
  callout_id:      string | null
  attempts:        number
  last_error:      string | null
  source:          string | null
  created_at:      string
}
