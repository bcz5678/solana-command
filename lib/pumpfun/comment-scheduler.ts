// lib/pumpfun/comment-scheduler.ts
//
// Durable "comment N minutes after this wallet bought" scheduler. The DB row
// (private.comment_schedule, see supabase/rpc/comment_schedule.sql) is the
// source of truth for what's due — this class is just a sweep loop that
// polls it, not the thing holding the actual schedule. That's what makes it
// durable: a server restart loses the in-memory loop, but instrumentation.ts
// restarts the sweep on boot and it immediately picks back up whatever's due
// or overdue in the table. Compare lib/volume/human-volume.ts's HumanVolumeBot,
// which uses the same non-blocking while-loop shape but keeps its actual
// state (wallet pool, positions) in process memory only — fine for that bot
// since a lost run just means restarting it, but wrong for this one where
// "the comment fires in 20 minutes" needs to survive a redeploy in between.

import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWalletKeypairById } from '@/lib/vault/get-wallet-by-id'
import { postCommentAsWallet } from '@/lib/pumpfun/comment-bot'
import { initializeConnection } from '@/app/api/utils/helpers'
import type { AutoCommentOptions } from '@/lib/types/trades'

export type { AutoCommentOptions }

const DEFAULT_POLL_INTERVAL_MS = 20_000
const CLAIM_BATCH_SIZE         = 10
// Small stagger between posts within one tick so a burst of due comments
// doesn't fire all at once — same reasoning as human-volume's inter-buy jitter.
const INTER_POST_JITTER_MS = { min: 1_000, max: 4_000 }

interface ClaimedRow {
  id:           string
  user_id:      string
  wallet_id:    string
  mint_address: string
  bank_ids:     string[]
  attempts:     number
}

async function walletHoldsMint(connection: Connection, owner: PublicKey, mint: string): Promise<boolean> {
  const [v1, v2] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
  ])
  const accounts = [...v1.value, ...v2.value]
  return accounts.some(({ account }) => {
    const info = (account.data as unknown as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } }).parsed?.info
    return info?.mint === mint && info?.tokenAmount?.amount !== '0' && info?.tokenAmount?.amount !== undefined
  })
}

function randomInRange(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

class CommentScheduler {
  private running    = false
  private connection: Connection | null = null
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS

  /** Idempotent — safe to call from every enqueue and from instrumentation.ts boot. */
  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
  }

  get isRunning(): boolean {
    return this.running
  }

  private getConnection(): Connection {
    if (!this.connection) this.connection = initializeConnection()
    return this.connection
  }

  private async loop(): Promise<void> {
    console.log('[comment-scheduler] sweep loop started')
    while (this.running) {
      try {
        await this.tick()
      } catch (err) {
        console.error('[comment-scheduler] tick failed:', err)
      }
      await wait(this.pollIntervalMs)
    }
    console.log('[comment-scheduler] sweep loop stopped')
  }

  private async tick(): Promise<void> {
    const admin = createAdminClient()

    const { data, error } = await admin.rpc('claim_due_comment_schedule', { p_limit: CLAIM_BATCH_SIZE })
    if (error) {
      console.error('[comment-scheduler] claim_due_comment_schedule failed:', error.message)
      return
    }

    const rows = (data ?? []) as ClaimedRow[]
    if (rows.length === 0) return

    console.log(`[comment-scheduler] claimed ${rows.length} due row(s)`)

    for (let i = 0; i < rows.length; i++) {
      if (i > 0) await wait(randomInRange(INTER_POST_JITTER_MS.min, INTER_POST_JITTER_MS.max))
      await this.processRow(admin, rows[i])
    }
  }

  private async processRow(admin: ReturnType<typeof createAdminClient>, row: ClaimedRow): Promise<void> {
    const { id, wallet_id, mint_address, bank_ids } = row

    let keypair: Keypair | null = null
    try {
      keypair = await getWalletKeypairById(wallet_id)

      const holds = await walletHoldsMint(this.getConnection(), keypair.publicKey, mint_address)
      if (!holds) {
        console.log(`[comment-scheduler] skip schedule=${id} wallet=${wallet_id} — no longer holds ${mint_address}`)
        await admin.rpc('mark_comment_schedule_skipped', { p_id: id, p_reason: 'wallet no longer holds token at fire time' })
        return
      }

      const { data: bankEntry, error: bankErr } = await admin
        .rpc('claim_comment_bank_entry', { p_bank_ids: bank_ids })
        .maybeSingle()

      if (bankErr || !bankEntry) {
        const message = bankErr?.message ?? 'comment bank is empty'
        console.error(`[comment-scheduler] no bank entry for schedule=${id}:`, message)
        await admin.rpc('mark_comment_schedule_failed', { p_id: id, p_error: message })
        return
      }

      const { id: bankEntryId, text } = bankEntry as { id: string; text: string }

      const result = await postCommentAsWallet(keypair, mint_address, text)

      if (!result.success) {
        console.error(`[comment-scheduler] callout failed schedule=${id}:`, result.error)
        await admin.rpc('mark_comment_schedule_failed', { p_id: id, p_error: result.error ?? 'callout failed' })
        return
      }

      const calloutId = (result.raw as { callout?: { calloutId?: string } } | null)?.callout?.calloutId ?? null
      console.log(`[comment-scheduler] posted schedule=${id} wallet=${wallet_id} mint=${mint_address} calloutId=${calloutId}`)
      await admin.rpc('mark_comment_schedule_posted', {
        p_id:              id,
        p_comment_bank_id: bankEntryId,
        p_callout_id:      calloutId,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[comment-scheduler] unexpected error schedule=${id}:`, message)
      await admin.rpc('mark_comment_schedule_failed', { p_id: id, p_error: message })
    } finally {
      keypair?.secretKey.fill(0)
    }
  }
}

// Module-level singleton — persists across requests within the same server
// process, same pattern as the `bot` singleton in app/api/auto/human/route.ts.
export const commentScheduler = new CommentScheduler()

export interface EnqueueCommentParams {
  userId:      string
  walletId:    string
  mintAddress: string
  /** Absolute fire time. Callers should randomize this (see delayMinMs/delayMaxMs helpers below). */
  scheduledFor: Date
  /** Bank(s) to pull from at fire time — required, non-empty. */
  bankIds:     string[]
  source?:     string
}

/**
 * Enqueues a durable "post a callout later" row and makes sure the sweep
 * loop is running. Call this from any buy route right after a confirmed buy.
 */
export async function enqueueComment(params: EnqueueCommentParams): Promise<{ enqueued: boolean; error?: string }> {
  if (params.bankIds.length === 0) {
    return { enqueued: false, error: 'bankIds must be non-empty' }
  }

  const admin = createAdminClient()

  const { data, error } = await admin.rpc('enqueue_comment_schedule', {
    p_user_id:       params.userId,
    p_wallet_id:      params.walletId,
    p_mint_address:   params.mintAddress,
    p_scheduled_for:  params.scheduledFor.toISOString(),
    p_bank_ids:       params.bankIds,
    p_source:         params.source ?? null,
  })

  if (error) {
    console.error('[comment-scheduler] enqueue_comment_schedule failed:', error.message)
    return { enqueued: false, error: error.message }
  }

  commentScheduler.start()

  const result = data as { id: string | null; enqueued: boolean }
  return { enqueued: result.enqueued }
}

/** Picks a random fire time `delayMinMs`–`delayMaxMs` from now — the "organic interval" knob. */
export function randomScheduledTime(delayMinMs: number, delayMaxMs: number): Date {
  return new Date(Date.now() + randomInRange(delayMinMs, delayMaxMs))
}

/**
 * Convenience wrapper for buy routes: resolves the wallet's owner (no
 * session/auth.uid() needed — see get_wallet_owner() in comment_schedule.sql),
 * rolls the (rolling-window-corrected) `probability`, and enqueues if it
 * hits. Swallows all errors to console — a scheduling failure must never
 * turn a successful buy into an error response.
 */
export async function maybeEnqueueCommentAfterBuy(
  walletId:    string,
  mintAddress: string,
  options:     AutoCommentOptions,
  source:      string,
): Promise<void> {
  if (!options.enabled) return
  if (options.bankIds.length === 0) {
    console.error(`[comment-scheduler] wallet=${walletId} autoComment enabled with no bankIds — skipped`)
    return
  }

  const target = options.probability ?? 1

  try {
    const admin = createAdminClient()
    const { data: userId, error } = await admin.rpc('get_wallet_owner', { p_wallet_id: walletId })
    if (error || !userId) {
      console.error(`[comment-scheduler] get_wallet_owner failed wallet=${walletId}:`, error?.message ?? 'no owner')
      return
    }

    // Below 100% target, use the rolling controller (roll_auto_comment_decision)
    // instead of an independent per-wallet coin flip — a flat Math.random() <
    // probability check is bursty at real batch sizes (a 30% target across 5
    // wallets can easily land 0 or 4-5 by chance), which is exactly the kind
    // of clustered pattern that reads as automated. At 100% there's nothing
    // to correct for, so skip the extra round trip.
    if (target < 1) {
      const { data: shouldComment, error: rollError } = await admin.rpc('roll_auto_comment_decision', {
        p_user_id:            userId,
        p_mint_address:       mintAddress,
        p_target_probability: target,
      })
      if (rollError) {
        console.error(`[comment-scheduler] roll_auto_comment_decision failed wallet=${walletId}:`, rollError.message)
        return
      }
      if (!shouldComment) return
    }

    const result = await enqueueComment({
      userId:       userId as string,
      walletId,
      mintAddress,
      scheduledFor: randomScheduledTime(options.delayMinMs, options.delayMaxMs),
      bankIds:      options.bankIds,
      source,
    })
    if (!result.enqueued && !result.error) {
      console.log(`[comment-scheduler] wallet=${walletId} mint=${mintAddress} already has an active schedule — skipped`)
    }
  } catch (err) {
    console.error(`[comment-scheduler] maybeEnqueueCommentAfterBuy failed wallet=${walletId}:`, err)
  }
}
