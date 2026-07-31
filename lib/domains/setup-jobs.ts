// lib/domains/setup-jobs.ts
//
// In-memory tracking for async domain-setup jobs handed off to the n8n
// webhook. Deliberately not backed by a DB table (yet) — state resets on
// server restart and isn't shared across server instances. Good enough
// for a single-instance shell; swap for a real store if this needs to
// survive restarts or scale horizontally.

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'failed'
export type DomainSetupJobStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

export interface DomainSetupStep {
  key:     string
  label:   string
  status:  StepStatus
  message: string | null
}

export interface DomainSetupJob {
  id:              string
  domain:          string
  distributionId:  string
  originPath:      string
  etag:            string
  siteDescription: string
  status:          DomainSetupJobStatus
  steps:           DomainSetupStep[]
  error:           string | null
  createdAt:       number
  updatedAt:       number
}

export interface CreateJobParams {
  domain:          string
  distributionId:  string
  originPath:      string
  etag:            string
  siteDescription: string
}

// The pipeline steps n8n is expected to report progress against via the
// callback route's `step` field. Keep in sync with the n8n flow.
const STEP_DEFINITIONS: { key: string; label: string }[] = [
  { key: 'namecheap_dns',     label: 'Updating Namecheap DNS records' },
  { key: 'cloudfront_origin', label: 'Repointing CloudFront origin path' },
  { key: 'cloudfront_alias',  label: 'Attaching domain alias to distribution' },
  { key: 'propagation',       label: 'Waiting for propagation' },
]

const jobs = new Map<string, DomainSetupJob>()

export function createJob(params: CreateJobParams): DomainSetupJob {
  const job: DomainSetupJob = {
    id: crypto.randomUUID(),
    ...params,
    status: 'pending',
    steps: STEP_DEFINITIONS.map((s) => ({ ...s, status: 'pending' as StepStatus, message: null })),
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  jobs.set(job.id, job)
  return job
}

export function getJob(id: string): DomainSetupJob | null {
  return jobs.get(id) ?? null
}

export function markJobFailed(id: string, message: string): DomainSetupJob | null {
  const job = jobs.get(id)
  if (!job) return null
  job.status = 'failed'
  job.error = message
  job.updatedAt = Date.now()
  return job
}

export interface ProgressUpdate {
  step?:      string
  status?:    StepStatus
  message?:   string
  jobStatus?: DomainSetupJobStatus
}

export function applyProgress(id: string, update: ProgressUpdate): DomainSetupJob | null {
  const job = jobs.get(id)
  if (!job) return null

  if (update.step) {
    const step = job.steps.find((s) => s.key === update.step)
    if (step) {
      if (update.status) step.status = update.status
      if (update.message !== undefined) step.message = update.message
    }
  }

  if (update.jobStatus) {
    job.status = update.jobStatus
  } else if (job.steps.some((s) => s.status === 'failed')) {
    job.status = 'failed'
  } else if (job.steps.every((s) => s.status === 'completed')) {
    job.status = 'completed'
  } else if (job.steps.some((s) => s.status === 'in_progress' || s.status === 'completed')) {
    job.status = 'in_progress'
  }

  if (job.status === 'failed' && update.message) job.error = update.message

  job.updatedAt = Date.now()
  return job
}
