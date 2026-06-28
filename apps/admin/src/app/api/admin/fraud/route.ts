import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? 'pending';
  const page = searchParams.get('page') ?? '1';
  const limit = searchParams.get('limit') ?? '50';

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ADMIN_API}/admin/fraud?status=${status}&page=${page}&limit=${limit}`,
      { headers: { cookie: req.headers.get('cookie') ?? '' } },
    );
  } catch {
    return NextResponse.json({ message: 'Admin service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();

  // The UI expects a flat array; unwrap the paginated envelope
  if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
  return NextResponse.json((data as { alerts: unknown[] }).alerts ?? data, { status: 200 });
}
