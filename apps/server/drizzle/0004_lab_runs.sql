CREATE TABLE `lab_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`symbol_id` text NOT NULL,
	`tf` text NOT NULL,
	`setups_key` text NOT NULL,
	`config_hash` text NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lab_runs_user_idx` ON `lab_runs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `lab_runs_family_idx` ON `lab_runs` (`user_id`,`symbol_id`,`setups_key`);