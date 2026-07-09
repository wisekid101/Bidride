import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/drivers?${searchParams}`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Admin service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();
  if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });

  // The UI expects a flat array; unwrap the paginated envelope
  return NextResponse.json((data as { drivers: unknown[] }).drivers ?? data, { status: 200 });
}
