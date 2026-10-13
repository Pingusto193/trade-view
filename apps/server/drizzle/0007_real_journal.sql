CREATE TABLE `real_events` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`time` integer NOT NULL,
	`kind` text NOT NULL,
	`price` real,
	`detail` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `real_trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `real_events_trade_idx` ON `real_events` (`trade_id`,`time`);--> statement-breakpoint
CREATE TABLE `real_fills` (
	`id` text PRIMARY KEY NOT NULL,
	`trade_id` text NOT NULL,
	`time` integer NOT NULL,
	`kind` text NOT NULL,
	`qty` real NOT NULL,
	`price` real NOT NULL,
	`fees_brl` real DEFAULT 0 NOT NULL,
	`fx` real DEFAULT 1 NOT NULL,
	FOREIGN KEY (`trade_id`) REFERENCES `real_trades`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `real_fills_trade_idx` ON `real_fills` (`trade_id`,`time`);--> statement-breakpoint
CREATE TABLE `real_trades` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`symbol` text NOT NULL,
	`symbol_id` text,
	`market` text NOT NULL,
	`side` text NOT NULL,
	`currency` text NOT NULL,
	`point_value` real NOT NULL,
	`initial_stop` real,
	`stop` real,
	`target` real,
	`note` text DEFAULT '' NOT NULL,
	`plan` text,
	`screenshot` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `real_trades_user_idx` ON `real_trades` (`user_id`,`created_at`);