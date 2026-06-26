import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get('lat') ?? '40.7357';
  const lng = searchParams.get('lng') ?? '-74.1724';

  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/marketplace/stats?lat=${lat}&lng=${lng}`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return NextResponse.json({ message: 'Marketplace service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
}
