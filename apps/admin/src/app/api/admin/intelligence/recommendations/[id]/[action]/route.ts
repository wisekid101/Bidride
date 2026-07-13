import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(['view', 'adopt', 'dismiss', 'outcome']);

export async function POST(req: NextRequest, { params }: { params: { id: string; action: string } }) {
  if (!UUID_RE.test(params.id) || !ACTIONS.has(params.action)) {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 });
  }
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${ADMIN_API}/admin/intelligence/recommendations/${params.id}/${params.action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: req.headers.get('cookie') ?? '' },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return NextResponse.json({ message: 'Intelligence service unreachable' }, { status: 503 });
  }
  const data = await upstream.json().catch(() => ({ message: 'Invalid upstream response' }));
  return NextResponse.json(data, { status: upstream.ok ? 200 : upstream.status });
}
