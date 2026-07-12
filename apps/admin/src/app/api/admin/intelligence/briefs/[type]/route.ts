import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';
const BRIEF_TYPES = new Set(['marketplace_health', 'money_map', 'ai_performance']);

export async function GET(req: NextRequest, { params }: { params: { type: string } }) {
  if (!BRIEF_TYPES.has(params.type)) {
    return NextResponse.json({ message: 'Unknown brief type' }, { status: 404 });
  }
  const refresh = req.nextUrl.searchParams.get('refresh') === 'true' ? '?refresh=true' : '';
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/intelligence/briefs/${params.type}${refresh}`, {
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
