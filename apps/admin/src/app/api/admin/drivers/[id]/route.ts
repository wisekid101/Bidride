import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/drivers/${params.id}`, {
      headers: { cookie: req.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json({ message: 'Admin service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
