CREATE TABLE `news_ai` (
	`news_id` text PRIMARY KEY NOT NULL,
	`summary` text,
	`relevance` integer,
	`sentiment` text,
	`assets` text DEFAULT '[]' NOT NULL,
	`model` text,
	`cost_usd` real,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`news_id`) REFERENCES `news_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `news_ai_settings` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`model` text,
	`monthly_limit_usd` real NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `news_ai_usage` (
	`user_id` integer NOT NULL,
	`month` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `month`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
