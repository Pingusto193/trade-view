CREATE TABLE `experiment_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`experiment_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`run` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `experiment_runs_user_idx` ON `experiment_runs` (`user_id`,`experiment_id`,`created_at`);