import { InMemoryJobQueue } from '../job-queue';

describe('InMemoryJobQueue', () => {
  describe('enqueue', () => {
    it('adds a job in pending state', () => {
      const q = new InMemoryJobQueue<string>();
      const id = q.enqueue('send_email', 'payload');
      const job = q.getJob(id);
      expect(job?.status).toBe('pending');
      expect(job?.name).toBe('send_email');
      expect(job?.payload).toBe('payload');
    });

    it('defaults to maxAttempts=3', () => {
      const q = new InMemoryJobQueue<string>();
      const id = q.enqueue('task', 'data');
      expect(q.getJob(id)?.maxAttempts).toBe(3);
    });

    it('respects custom maxAttempts', () => {
      const q = new InMemoryJobQueue<string>();
      const id = q.enqueue('task', 'data', { maxAttempts: 5 });
      expect(q.getJob(id)?.maxAttempts).toBe(5);
    });
  });

  describe('process — success', () => {
    it('marks job as succeeded after handler completes', async () => {
      const q = new InMemoryJobQueue<string>();
      const id = q.enqueue('task', 'payload');
      await q.process(async () => {});
      const job = q.getJob(id);
      expect(job?.status).toBe('succeeded');
      expect(job?.completedAt).toBeDefined();
    });

    it('calls handler with the job', async () => {
      const q = new InMemoryJobQueue<string>();
      const id = q.enqueue('task', 'hello');
      const received: string[] = [];
      await q.process(async (job) => { received.push(job.payload); });
      expect(received).toContain('hello');
    });
  });

  describe('process — failure and retry', () => {
    it('retries failing jobs when scheduledAt is in the past', async () => {
      // Advance Date.now so backoff-scheduled jobs are due
      const realNow = Date.now;
      let fakeNow = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

      const q = new InMemoryJobQueue<number>();
      q.enqueue('failing', 1, { maxAttempts: 3 });
      let calls = 0;
      const handler = async () => { calls++; throw new Error('fail'); };

      await q.process(handler);           // attempt 1 — fails, schedules retry at +1000ms
      fakeNow += 2_000;                   // advance past backoff
      await q.process(handler);           // attempt 2 — fails, schedules retry at +2000ms
      fakeNow += 4_000;                   // advance past backoff
      await q.process(handler);           // attempt 3 → dead

      jest.spyOn(Date, 'now').mockRestore();
      expect(calls).toBe(3);
    });

    it('moves job to DLQ after exhausting retries', async () => {
      const q = new InMemoryJobQueue<number>();
      q.enqueue('failing', 1, { maxAttempts: 1 });
      await q.process(async () => { throw new Error('fatal'); });
      expect(q.getDeadLetterQueue()).toHaveLength(1);
      expect(q.getDeadLetterQueue()[0].name).toBe('failing');
    });

    it('records last error message on failure', async () => {
      const q = new InMemoryJobQueue<number>();
      const id = q.enqueue('failing', 1, { maxAttempts: 3 });
      // Fail once (stays in queue as pending with backoff)
      await q.process(async () => { throw new Error('specific error'); });
      // After first failure, job is still in queue with attempts=1
      const job = q.getJob(id);
      expect(job?.lastError).toContain('specific error');
    });
  });

  describe('requeue from DLQ', () => {
    it('moves job from DLQ back to queue', async () => {
      const q = new InMemoryJobQueue<number>();
      const id = q.enqueue('task', 1, { maxAttempts: 1 });
      await q.process(async () => { throw new Error('fail'); });
      expect(q.getDeadLetterQueue()).toHaveLength(1);

      const ok = q.requeue(id);
      expect(ok).toBe(true);
      expect(q.getDeadLetterQueue()).toHaveLength(0);
      expect(q.getJob(id)?.status).toBe('pending');
      expect(q.getJob(id)?.attempts).toBe(0);
    });

    it('returns false for non-existent DLQ id', () => {
      const q = new InMemoryJobQueue();
      expect(q.requeue('nonexistent')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('counts dead jobs from DLQ', async () => {
      const q = new InMemoryJobQueue<number>();
      q.enqueue('task', 1, { maxAttempts: 1 });
      await q.process(async () => { throw new Error('fail'); });
      const stats = q.getStats();
      expect(stats.dead).toBe(1);
    });

    it('tracks pending and succeeded counts', async () => {
      const q = new InMemoryJobQueue<number>();
      q.enqueue('t1', 1);
      q.enqueue('t2', 2);
      await q.process(async () => {});
      const stats = q.getStats();
      expect(stats.succeeded).toBe(2);
      expect(stats.pending).toBe(0);
    });
  });
});
