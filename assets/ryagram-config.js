// Supabase project that stores Ryagram waitlist signups (see supabase/ryagram-waitlist.sql).
// supabaseUrl: the Project URL, e.g. https://abcdefghijklmnop.supabase.co
// supabaseKey: the publishable key (sb_publishable_...) or the legacy anon key.
// Both are meant to be public; the database only lets this key add rows.
// Never put a secret or service_role key here.
// Empty means not connected: the form sends nothing and points people to email.
window.ryagramConfig = Object.freeze({ supabaseUrl: '', supabaseKey: '' });
