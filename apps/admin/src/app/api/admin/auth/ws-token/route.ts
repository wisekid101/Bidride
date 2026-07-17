import { NextRequest, NextResponse } from 'next/server';

const ADMIN_SERVICE = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  const res = await fetch(`${ADMIN_SERVICE}/admin/auth/ws-token`, {
    method: 'GET',
    headers: { cookie: req.headers.get('cookie') ?? '' },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.status });
}
