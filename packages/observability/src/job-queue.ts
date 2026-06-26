export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'dead';

export interface Job<T = unknown> {
  id: string;
  name: string;
  payload: T;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError?: string;
  createdAt: number;
  scheduledAt: number;
  completedAt?: number;
}

export interface JobQueueStats {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  dead: number;
}

export class InMemoryJobQueue<T = unknown> {
  private readonly jobs = new Map<string, Job<T>>();
  private readonly dlq: Job<T>[] = [];
  private idSeq = 0;

  enqueue(name: string, payload: T, opts?: { maxAttempts?: number; delayMs?: number }): string {
    const id = `job_${++this.idSeq}_${Date.now()}`;
    this.jobs.set(id, {
      id,
      name,
      payload,
      status: 'pending',
      attempts: 0,
      maxAttempts: opts?.maxAttempts ?? 3,
      createdAt: Date.now(),
      scheduledAt: Date.now() + (opts?.delayMs ?? 0),
    });
    return id;
  }

  async process(
    handler: (job: Job<T>) => Promise<void>,
    opts?: { maxConcurrent?: number },
  ): Promise<void> {
    const now = Date.now();
    const pending = [...this.jobs.values()].filter(
      (j) => j.status === 'pending' && j.scheduledAt <= now,
    );
    const batch = pending.slice(0, opts?.maxConcurrent ?? 10);

    await Promise.allSettled(
      batch.map(async (job) => {
        job.status = 'running';
        job.attempts++;
        try {
          await handler(job);
          job.status = 'succeeded';
          job.completedAt = Date.now();
        } catch (err) {
          job.lastError = err instanceof Error ? err.message : String(err);
          if (job.attempts >= job.maxAttempts) {
            job.status = 'dead';
            this.dlq.push({ ...job });
            this.jobs.delete(job.id);
          } else {
            // exponential backoff
            const backoff = Math.min(1000 * Math.pow(2, job.attempts - 1), 60_000);
            job.status = 'pending';
            job.scheduledAt = Date.now() + backoff;
          }
        }
      }),
    );
  }

  getJob(id: string): Job<T> | undefined {
    return this.jobs.get(id);
  }

  getDeadLetterQueue(): Job<T>[] {
    return [...this.dlq];
  }

  requeue(deadJobId: string): boolean {
    const job = this.dlq.find((j) => j.id === deadJobId);
    if (!job) return false;
    this.dlq.splice(this.dlq.indexOf(job), 1);
    job.status = 'pending';
    job.attempts = 0;
    job.scheduledAt = Date.now();
    this.jobs.set(job.id, job);
    return true;
  }

  getStats(): JobQueueStats {
    const counts: JobQueueStats = { pending: 0, running: 0, succeeded: 0, failed: 0, dead: this.dlq.length };
    for (const j of this.jobs.values()) {
      if (j.status === 'pending') counts.pending++;
      else if (j.status === 'running') counts.running++;
      else if (j.status === 'succeeded') counts.succeeded++;
      else if (j.status === 'failed') counts.failed++;
    }
    return counts;
  }
}
