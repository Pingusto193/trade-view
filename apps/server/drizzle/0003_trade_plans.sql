CREATE TABLE `trade_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`order_id` text,
	`position_id` text,
	`json` text NOT NULL,
	`released` integer NOT NULL,
	`screenshot` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `trade_plans_order_idx` ON `trade_plans` (`order_id`);--> statement-breakpoint
CREATE INDEX `trade_plans_position_idx` ON `trade_plans` (`position_id`);