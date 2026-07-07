import { NextResponse } from 'next/server';
import { clearSession } from '@/lib/session';

/** End the session by clearing the cookie. */
export async function POST() {
  return clearSession(new NextResponse(null, { status: 204 }));
}
