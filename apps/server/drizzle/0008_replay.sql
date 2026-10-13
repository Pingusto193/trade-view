CREATE TABLE `replay_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`symbol_id` text NOT NULL,
	`tf` text NOT NULL,
	`hidden` integer NOT NULL,
	`meta` text NOT NULL,
	`candles` text NOT NULL,
	`start_index` integer NOT NULL,
	`cursor` integer NOT NULL,
	`book` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `replay_sessions_user_idx` ON `replay_sessions` (`user_id`,`created_at`);