import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; type: string } },
) {
  const body = await req.text();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ADMIN_API}/admin/drivers/${params.id}/documents/${params.type}/review`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: req.headers.get('cookie') ?? '',
        },
        body: body || '{}',
      },
    );
  } catch {
    return NextResponse.json({ message: 'Admin service unreachable' }, { status: 503 });
  }

  const data = await upstream.json();
  return NextResponse.json(data, { status: upstream.status });
}
