-- Existing installs already have this table: it was created by raw DDL at
-- startup and never migrated. Without IF NOT EXISTS this statement throws, and
-- a failed migration makes DrizzleService delete and recreate the cache, which
-- would silently destroy every classified topic on upgrade.
CREATE TABLE IF NOT EXISTS `session_topics` (
	`session_id` text PRIMARY KEY,
	`label` text NOT NULL,
	`icon` text NOT NULL,
	`source_text` text NOT NULL,
	`classified_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `source` text DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `source_project_key` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `canonical_path` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source` text DEFAULT 'claude-code' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `source_session_key` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `native_cost_usd` real;--> statement-breakpoint
ALTER TABLE `sessions` ADD `cost_confidence` text DEFAULT 'estimated' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_projects_canonical_path` ON `projects` (`canonical_path`);--> statement-breakpoint
CREATE INDEX `idx_sessions_source` ON `sessions` (`source`);