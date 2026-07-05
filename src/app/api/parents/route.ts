import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { resolveBuyer, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';

// GET /api/parents — list the signed-in buyer's parents (newest first).
export async function GET(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  }
  try {
    const parents = await parentRepo.listForBuyer(db(), buyerId);
    return NextResponse.json({ parents });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}

// POST /api/parents — create a parent profile (onboarding). Not yet activated.
export async function POST(req: NextRequest) {
  const buyerId = await resolveBuyer(req);
  if (!buyerId) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in required.' } }, { status: 401 });
  }
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: { code: 'no_db', message: 'Database not configured.' } }, { status: 503 });
  }
  try {
    const body = await req.json();
    const parent = await parentRepo.create(db(), {
      buyerId,
      firstName: body.first_name,
      pronouns: body.pronouns,
      relationship: body.relationship,
      city: body.city,
      language: body.language,
      largeText: body.large_text,
      voiceFirst: body.voice_first,
      speechRate: body.speech_rate,
    });
    return NextResponse.json({ parent }, { status: 201 });
  } catch (err) {
    const { status, body } = errorToResponse(err);
    return NextResponse.json(body, { status });
  }
}
