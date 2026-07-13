import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';
const ALLOWED_PARAMS = new Set(['domain', 'status', 'constitutionTag', 'from', 'to', 'cursor', 'limit']);

export async function GET(req: NextRequest) {
  const params = new URLSearchParams();
  req.nextUrl.searchParams.forEach((v, k) => {
    if (ALLOWED_PARAMS.has(k) && v.length <= 100) params.set(k, v);
  });
  const qs = params.toString();
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/intelligence/recommendations${qs ? `?${qs}` : ''}`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return NextResponse.json({ message: 'Intelligence service unreachable' }, { status: 503 });
  }
  const data = await upstream.json().catch(() => ({ message: 'Invalid upstream response' }));
  return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
}
