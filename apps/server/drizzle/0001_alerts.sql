CREATE TABLE `alert_fires` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`alert_id` text,
	`dedup_key` text NOT NULL,
	`symbol_id` text NOT NULL,
	`tf` text NOT NULL,
	`fired_at` integer NOT NULL,
	`candle_time` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`url` text NOT NULL,
	`delivery` text DEFAULT '{}' NOT NULL,
	`silenced` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alert_fires_dedup_idx` ON `alert_fires` (`user_id`,`dedup_key`);--> statement-breakpoint
CREATE INDEX `alert_fires_user_time_idx` ON `alert_fires` (`user_id`,`fired_at`);--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`symbol_id` text NOT NULL,
	`tf` text NOT NULL,
	`json` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_fired_at` integer,
	`status` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `alerts_user_idx` ON `alerts` (`user_id`);--> statement-breakpoint
CREATE TABLE `notify_settings` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`quiet_enabled` integer DEFAULT false NOT NULL,
	`quiet_start` text DEFAULT '22:00' NOT NULL,
	`quiet_end` text DEFAULT '07:00' NOT NULL,
	`telegram_token_enc` text,
	`telegram_chat_id` text,
	`email` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`label` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_ok_at` integer,
	`fail_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `push_user_idx` ON `push_subscriptions` (`user_id`);