/**
 * /api/library/[id]
 *
 * GET    — Return the full saved analysis (complete analysis_json snapshot).
 * DELETE — Remove the saved row. RLS ensures the user can only delete their own.
 * PATCH  — Update mutable fields (currently: notes).
 *
 * Refresh is a distinct concern — see ./refresh/route.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getEffectiveUserId }        from '@/lib/library-auth';
import sql                           from '@/lib/db';

export const runtime = 'nodejs';

type Params = { params: Promise<{ id: string }> };

// ─── GET — full saved analysis ─────────────────────────────────────────────

export async function GET(_req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;

  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const [row] = await sql<{
    id:               string;
    source_url:       string;
    source:           'manual' | 'idealista_import';
    tvi_score:        string | number | null;
    notes:            string | null;
    analysed_at:      string;
    created_at:       string;
    updated_at:       string;
    import_batch_id:  string | null;
    analysis_json:    unknown;
  }[]>`
    SELECT
      id, source_url, source, tvi_score, notes,
      analysed_at, created_at, updated_at, import_batch_id, analysis_json
    FROM saved_analyses
    WHERE id = ${id} AND user_id = ${userId}
    LIMIT 1
  `;

  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({
    ...row,
    tvi_score: row.tvi_score != null ? Number(row.tvi_score) : null,
  });
}

// ─── DELETE — remove saved row ─────────────────────────────────────────────

export async function DELETE(_req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;

  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const result = await sql`
    DELETE FROM saved_analyses
    WHERE id = ${id} AND user_id = ${userId}
  `;

  if (result.count === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

// ─── PATCH — update mutable fields ─────────────────────────────────────────
// Currently only `notes`. Adding future mutable fields (tags, pinned flag,
// etc.) means extending this handler rather than adding new routes.

export async function PATCH(req: NextRequest, ctx: Params) {
  const { id } = await ctx.params;

  const userId = await getEffectiveUserId();
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Allow explicit null to clear notes. Trim + cap at 2000 chars.
  const notesProvided = Object.prototype.hasOwnProperty.call(body, 'notes');
  const notes = notesProvided
    ? (body.notes === null
        ? null
        : typeof body.notes === 'string'
          ? body.notes.slice(0, 2000)
          : undefined)
    : undefined;

  if (!notesProvided) {
    return NextResponse.json({ error: 'no_fields_to_update' }, { status: 400 });
  }
  if (notes === undefined) {
    return NextResponse.json({ error: 'invalid_notes' }, { status: 400 });
  }

  const [row] = await sql<{ id: string; notes: string | null; updated_at: string }[]>`
    UPDATE saved_analyses
       SET notes = ${notes}, updated_at = NOW()
     WHERE id = ${id} AND user_id = ${userId}
     RETURNING id, notes, updated_at
  `;

  if (!row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json(row);
}
