import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function POST(req: NextRequest) {
  const body = await req.json();

  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json({ message: 'Admin service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  // Forward the HttpOnly cookie from admin-service to the browser
  const res = NextResponse.json(data, { status: 200 });
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) {
    res.headers.set('set-cookie', setCookie);
  }

  return res;
}
