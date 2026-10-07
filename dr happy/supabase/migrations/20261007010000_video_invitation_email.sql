ALTER TABLE public.video_consultations
  ADD COLUMN invitation_email_claimed_at timestamptz,
  ADD COLUMN invitation_email_sent_at timestamptz;
