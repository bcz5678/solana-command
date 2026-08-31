// lib/types/comment-bank.ts

export interface CommentBankEntry {
  id:           string
  text:         string
  tag:          string | null
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
  callout_id:      string | null
  attempts:        number
  last_error:      string | null
  source:          string | null
  created_at:      string
}
