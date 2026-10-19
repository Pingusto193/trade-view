CREATE TABLE `assistant_settings` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`model` text NOT NULL,
	`monthly_limit_usd` real NOT NULL,
	`price_in` real NOT NULL,
	`price_out` real NOT NULL,
	`api_key` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `assistant_usage` (
	`user_id` integer NOT NULL,
	`month` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `month`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
