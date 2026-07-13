// DEV-ONLY runtime paths for the stack scripts. Logs live under the OS temp dir
// (outside the repo, so they never pollute the working tree) in a stable,
// non-machine-specific location derived from tmpdir().
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LOG_DIR = process.env.BIDRIDE_LOG_DIR || join(tmpdir(), 'bidride-dev');
