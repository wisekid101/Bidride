import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/intelligence/briefs`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return NextResponse.json({ message: 'Intelligence service unreachable' }, { status: 503 });
  }
  const data = await upstream.json().catch(() => ({ message: 'Invalid upstream response' }));
  return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
}
