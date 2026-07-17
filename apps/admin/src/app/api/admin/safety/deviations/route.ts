import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const riskLevel = searchParams.get('riskLevel') ?? '';
  const limit = searchParams.get('limit') ?? '50';
  const qs = new URLSearchParams();
  if (riskLevel) qs.set('riskLevel', riskLevel);
  qs.set('limit', limit);

  try {
    const upstream = await fetch(
      `${ADMIN_API}/admin/safety/deviations?${qs.toString()}`,
      { headers: { cookie: req.headers.get('cookie') ?? '' }, cache: 'no-store', signal: AbortSignal.timeout(5000) },
    );
    return NextResponse.json(await upstream.json(), { status: upstream.ok ? 200 : upstream.status });
  } catch {
    return NextResponse.json({ message: 'Safety service unreachable' }, { status: 503 });
  }
}
