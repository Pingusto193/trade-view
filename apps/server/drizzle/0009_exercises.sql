CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`level` integer NOT NULL,
	`setups` text,
	`symbol_id` text NOT NULL,
	`tf` text NOT NULL,
	`meta` text NOT NULL,
	`candles` text NOT NULL,
	`shown` integer NOT NULL,
	`questions` text NOT NULL,
	`answer` text NOT NULL,
	`outcome` text NOT NULL,
	`given` text,
	`graded` text,
	`score` integer,
	`total` integer,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercises_user_idx` ON `exercises` (`user_id`,`created_at`);