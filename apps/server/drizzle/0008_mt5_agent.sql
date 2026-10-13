CREATE TABLE `mt5_symbols` (
	`source` text NOT NULL,
	`symbol` text NOT NULL,
	`token_id` integer NOT NULL,
	`json` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`source`, `symbol`),
	FOREIGN KEY (`token_id`) REFERENCES `mt5_tokens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mt5_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`last_info` text,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mt5_tokens_token_hash_unique` ON `mt5_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mt5_tokens_user_idx` ON `mt5_tokens` (`user_id`);