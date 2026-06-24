import { NextRequest, NextResponse } from 'next/server';

const ADMIN_API = process.env.ADMIN_SERVICE_URL ?? 'http://localhost:3011';

export async function POST(req: NextRequest) {
  const cookie = req.headers.get('cookie') ?? '';

  try {
    await fetch(`${ADMIN_API}/admin/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });
  } catch {
    // Proceed with local cookie clear even if upstream is unreachable
  }

  const res = NextResponse.json({ ok: true });
  // Expire the cookie in the browser
  res.cookies.set('admin_session', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  return res;
}
