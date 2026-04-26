// Seeds a single dev user we can attribute Property Library rows to.
// auth.users is normally managed by GoTrue, but for local dev we insert
// directly with a fixed UUID and a stub email. user_profiles row created
// to satisfy FKs from saved_analyses / import_batches.
//
// Prints the UUID — paste it into .env.local as DEV_USER_ID.
import postgres from 'postgres';
import crypto from 'node:crypto';

const url = process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL;
const sql = postgres(url, { ssl: 'require', max: 1, prepare: !url.includes('pooler.supabase.com') });

const FIXED_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL    = 'dev@qolify.local';

try {
  // Check if already present.
  const existing = await sql`SELECT id FROM auth.users WHERE id = ${FIXED_ID}`;
  if (existing.length === 0) {
    await sql`
      INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, is_super_admin
      ) VALUES (
        ${FIXED_ID},
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        ${EMAIL},
        ${'$2a$10$' + crypto.randomBytes(16).toString('hex')},
        NOW(), NOW(), NOW(),
        '{"provider":"dev","providers":["dev"]}'::jsonb,
        '{}'::jsonb,
        false
      )
    `;
    console.log('Inserted auth.users row');
  } else {
    console.log('auth.users row already exists');
  }

  await sql`
    INSERT INTO user_profiles (id, email, tier)
    VALUES (${FIXED_ID}, ${EMAIL}, 'intelligence')
    ON CONFLICT (id) DO NOTHING
  `;
  console.log('user_profiles ensured');
  console.log('\nDEV_USER_ID=' + FIXED_ID);
} catch (e) {
  console.error('Seed failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
