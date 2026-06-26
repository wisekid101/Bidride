import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const upstream = await fetch(`${ADMIN_API}/admin/safety/sos/${params.id}/assign`, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
      signal: AbortSignal.timeout(5000),
    });
    return NextResponse.json(await upstream.json(), { status: upstream.ok ? 200 : upstream.status });
  } catch {
    return NextResponse.json({ message: 'Safety service unreachable' }, { status: 503 });
  }
}
