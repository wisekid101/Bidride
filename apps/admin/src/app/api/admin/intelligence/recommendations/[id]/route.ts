import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ message: 'Invalid id' }, { status: 400 });
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/intelligence/recommendations/${params.id}`, {
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
