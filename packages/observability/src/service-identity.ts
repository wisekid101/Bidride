/**
 * Service identity, stamped on every log line and every EMF record (PO-1A).
 *
 * Without it a CloudWatch log group full of JSON tells you what happened but
 * not who or which build. `commitSha` in particular is what makes "did this
 * start after the last deploy?" answerable in one query instead of a guess.
 *
 * Read once at module load: these values cannot change within a process, and
 * re-reading env on every log line is pure waste on a hot path.
 */

export interface ServiceIdentity {
  service: string;
  env: string;
  version: string;
  /** Short commit SHA of the running build; 'unknown' when unset. */
  commitSha: string;
}

const UNKNOWN = 'unknown';

function readIdentity(): ServiceIdentity {
  const e = process.env;
  return {
    service: e.SERVICE_NAME ?? e.npm_package_name ?? UNKNOWN,
    env: e.NODE_ENV ?? UNKNOWN,
    version: e.SERVICE_VERSION ?? e.npm_package_version ?? UNKNOWN,
    // GIT_COMMIT_SHA is the build-time variable; the others are CI conventions
    // this repository may adopt later.
    commitSha: (e.GIT_COMMIT_SHA ?? e.GIT_SHA ?? e.COMMIT_SHA ?? UNKNOWN).slice(0, 12),
  };
}

let identity: ServiceIdentity = readIdentity();

export function getServiceIdentity(): ServiceIdentity {
  return identity;
}

/**
 * Override the identity. For tests, and for a service that knows its own name
 * better than the environment does.
 */
export function setServiceIdentity(partial: Partial<ServiceIdentity>): void {
  identity = { ...identity, ...partial };
}

/** Re-read from the environment. Used by tests that mutate process.env. */
export function refreshServiceIdentity(): void {
  identity = readIdentity();
}
