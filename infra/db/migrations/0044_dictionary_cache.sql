-- Cache for third-party dictionary lookups behind /api/dictionary/:word.
--
-- The dictionary-panel bobbin used to call api.dictionaryapi.dev from the
-- browser. That host is a Cloudflare-fronted community mirror of Wiktionary,
-- and when its origin is down only words still warm in the edge cache answer --
-- so lookups appeared to fail at random, per word and per POP.
--
-- Rows are keyed by word alone: definitions are effectively immutable and carry
-- no project or user scope, so one author's lookup warms the cache for everyone.
-- `not_found` stores the negative answer as well, keeping typos from re-hitting
-- upstream on every selection.
--
-- Nothing is written here unless an upstream gave a settled answer. Outages are
-- never cached -- the failure this table absorbs must not be able to persist
-- itself. TTLs are applied at read time (see lib/dictionary.ts).

CREATE TABLE IF NOT EXISTS "dictionary_cache" (
	"word" varchar(128) PRIMARY KEY NOT NULL,
	"payload" jsonb,
	"source" varchar(32) NOT NULL,
	"not_found" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dictionary_cache_fetched_at_idx" ON "dictionary_cache" USING btree ("fetched_at");
