CREATE TABLE `scan_results` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`scan_id` text,
	`running` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	`snapshot` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scan_results_user_idx` ON `scan_results` (`user_id`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`config` text NOT NULL,
	`schedule` text NOT NULL,
	`auto_state` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scans_user_idx` ON `scans` (`user_id`);