CREATE FUNCTION next_punishment(bigint, bigint) RETURNS int
LANGUAGE plpgsql
stable
AS $$
DECLARE next_punishment int;
BEGIN
  SELECT count INTO next_punishment FROM filter_triggers WHERE guild_id = $1 AND user_id = $2;
  if next_punishment IS NULL THEN return 1; end if;
  return next_punishment + 1;
END;
$$;

CREATE FUNCTION next_case(bigint) RETURNS int
LANGUAGE plpgsql
stable
AS $$
DECLARE next_id int;
BEGIN
  SELECT max(case_id) INTO next_id FROM cases WHERE guild_id = $1;
  if next_id IS NULL THEN return 1; end if;
  return next_id + 1;
END;
$$;

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id bigint PRIMARY KEY,
  mod_role bigint,
  admin_role bigint,
  mute_role bigint,
  auto_pardon_mutes_after int,
  use_url_filters int NOT NULL DEFAULT 0,
  use_file_filters boolean NOT NULL DEFAULT false,
  use_invite_filters boolean NOT NULL DEFAULT false,
  mod_action_log_channel bigint,
  filter_trigger_log_channel bigint,
  user_update_log_channel bigint,
  message_update_log_channel bigint,
  assignable_roles_prompt text,
  min_join_age int,
  no_blank_avatar boolean NOT NULL DEFAULT false,
  reports_channel bigint
);

CREATE TABLE IF NOT EXISTS webhook_tokens (
  channel_id bigint PRIMARY KEY,
  webhook_id bigint NOT NULL,
  webhook_token text NOT NULL
);

CREATE TABLE IF NOT EXISTS self_assignable_roles (
  role_id bigint PRIMARY KEY,
  guild_id bigint NOT NULL REFERENCES guild_settings ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS warn_punishments (
  guild_id bigint NOT NULL REFERENCES guild_settings ON DELETE CASCADE,
  warns int NOT NULL,
  action_type int NOT NULL,
  duration int,
  PRIMARY KEY (guild_id, warns)
);

CREATE TABLE IF NOT EXISTS cases (
  id serial PRIMARY KEY,
  guild_id bigint NOT NULL,
  log_message_id bigint,
  case_id int NOT NULL,
  ref_id int,
  target_id bigint NOT NULL,
  target_tag text NOT NULl,
  mod_id bigint,
  mod_tag text,
  action_type int NOT NULL,
  reason text,
  expires_at timestamptz,
  processed boolean NOT NULL DEFAULT true,
  pardoned_by bigint,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS unmute_roles (
  case_id int REFERENCES cases(id) ON DELETE CASCADE,
  role_id bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id bigint PRIMARY KEY,
  perms bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS apps (
  app_id serial PRIMARY KEY,
  name varchar(32) NOT NULL,
  perms bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_guilds (
  app_id int NOT NULL REFERENCES apps ON DELETE CASCADE,
  guild_id bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sigs (
  app_id int NOT NULL REFERENCES apps ON DELETE CASCADE,
  sig text NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS malicious_files (
  file_id serial PRIMARY KEY,
  file_hash text UNIQUE NOT NULL,
  admin_id bigint NOT NULL REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_modified_at timestamptz NOT NULL DEFAULT NOW(),
  category int NOT NULL
);

CREATE TABLE IF NOT EXISTS malicious_urls (
  url_id serial PRIMARY KEY,
  url text UNIQUE NOT NULL,
  admin_id bigint NOT NULL REFERENCES users(user_id),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  last_modified_at timestamptz NOT NULL DEFAULT NOW(),
  category int NOT NULL
);

CREATE TABLE IF NOT EXISTS banned_words (
  guild_id bigint NOT NULL,
  word text NOT NULL,
  flags bigint NOT NULL,
  duration int,
  PRIMARY KEY (guild_id, word)
);

CREATE TABLE IF NOT EXISTS filter_triggers (
  guild_id bigint NOT NULL,
  user_id bigint NOT NULL,
  count int NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS filter_ignores (
  channel_id bigint NOT NULL PRIMARY KEY,
  guild_id bigint NOT NULL,
  value bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS allowed_invites (
  guild_id bigint NOT NULL,
  invite_code text NOT NULL,
  PRIMARY KEY (guild_id, invite_code)
);

CREATE TABLE IF NOT EXISTS reported_messages (
  message_id bigint PRIMARY KEY,
  report_message_id bigint,
  ack boolean DEFAULT false NOT NULL
);

CREATE TABLE IF NOT EXISTS message_reporters (
  message_id bigint NOT NULL REFERENCES reported_messages ON DELETE CASCADE,
  original boolean DEFAULT false NOT NULL,
  reporter_id bigint NOT NULL,
  reporter_tag text NOT NULL,
  PRIMARY KEY (message_id, reporter_id)
);
