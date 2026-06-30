import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getBuyerId, errorToResponse } from '@/lib/auth';
import { parentRepo } from '@/lib/repos/parent';

// POST /api/parents — create a parent profile (onboarding). Not yet activated.
export async function POST(req: NextRequest) {
  const buyerId = getBuyerId(req);
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
