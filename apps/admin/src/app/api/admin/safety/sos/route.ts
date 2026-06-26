import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  const status = new URL(req.url).searchParams.get('status') ?? '';
  try {
    const upstream = await fetch(
      `${ADMIN_API}/admin/safety/sos${status ? `?status=${status}` : ''}`,
      { headers: { cookie: req.headers.get('cookie') ?? '' }, signal: AbortSignal.timeout(5000) },
    );
    return NextResponse.json(await upstream.json(), { status: upstream.ok ? 200 : upstream.status });
  } catch {
    return NextResponse.json({ message: 'Safety service unreachable' }, { status: 503 });
  }
}
