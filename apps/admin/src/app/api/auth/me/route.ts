import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function POST(req: NextRequest) {
  const cookie = req.headers.get('cookie') ?? '';

  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/auth/me`, {
      method: 'POST',
      headers: { cookie },
    });
  } catch {
    return NextResponse.json({ message: 'Admin service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
