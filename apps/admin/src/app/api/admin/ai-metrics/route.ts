import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/ai/metrics`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      signal: AbortSignal.timeout(6000),
    });
  } catch {
    return NextResponse.json({ message: 'AI service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
}
