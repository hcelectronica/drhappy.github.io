CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT vault.create_secret(
  'drhappy-reminders-2026-9f4c7a1e-6b2d-4d80-a91f-3e8c6b72d514',
  'appointment-reminders-cron-secret',
  'Secret interno para ejecutar recordatorios automáticos de turnos.'
)
WHERE NOT EXISTS (
  SELECT 1 FROM vault.decrypted_secrets WHERE name = 'appointment-reminders-cron-secret'
);

SELECT cron.schedule(
  'send-appointment-reminders-every-5-minutes',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://stzsobirxdivbgqxwkhc.supabase.co/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'appointment-reminders-cron-secret')
    ),
    body := '{}'::jsonb
  );
  $$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-appointment-reminders-every-5-minutes'
);
