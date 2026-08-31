// instrumentation.ts
//
// Next.js calls register() once when a new server instance starts, before
// it accepts requests — https://nextjs.org/docs/app/guides/instrumentation.
// Used here to resume the durable comment scheduler (lib/pumpfun/comment-scheduler.ts)
// immediately on boot, so a restart doesn't leave overdue rows in
// private.comment_schedule sitting untouched until the next enqueue happens
// to kick the sweep loop back on.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { commentScheduler } = await import('@/lib/pumpfun/comment-scheduler')
    commentScheduler.start()
  }
}
