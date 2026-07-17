import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.text();
    const upstream = await fetch(`${ADMIN_API}/admin/safety/sos/${params.id}/resolve`, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '', 'content-type': 'application/json' },
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.ok ? 200 : upstream.status });
  } catch {
    return NextResponse.json({ message: 'Safety service unreachable' }, { status: 503 });
  }
}
