import { NextRequest, NextResponse } from 'next/server';

const ADMIN_SERVICE_URL = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function GET(req: NextRequest) {
  const { pathname, search } = new URL(req.url);
  const subpath = pathname.replace('/api/admin/finance', '');
  const upstream = `${ADMIN_SERVICE_URL}/admin/finance${subpath}${search}`;

  try {
    const res = await fetch(upstream, {
      headers: { authorization: req.headers.get('authorization') ?? '' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Finance service unavailable' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const { pathname, search } = new URL(req.url);
  const subpath = pathname.replace('/api/admin/finance', '');
  const upstream = `${ADMIN_SERVICE_URL}/admin/finance${subpath}${search}`;

  try {
    const res = await fetch(upstream, {
      method: 'POST',
      headers: { authorization: req.headers.get('authorization') ?? '' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Finance service unavailable' }, { status: 503 });
  }
}
