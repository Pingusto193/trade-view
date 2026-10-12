CREATE TABLE `paper_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`initial_balance` real NOT NULL,
	`cash` real NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`costs` text DEFAULT '{}' NOT NULL,
	`fx_manual` real,
	`created_at` integer NOT NULL,
	`reset_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_accounts_user_idx` ON `paper_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `paper_events` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`time` integer NOT NULL,
	`kind` text NOT NULL,
	`symbol_id` text,
	`position_id` text,
	`order_id` text,
	`price` real,
	`qty` real,
	`pnl_brl` real,
	`fees_brl` real,
	`fx` real,
	`detail` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `paper_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_events_account_idx` ON `paper_events` (`account_id`,`time`);--> statement-breakpoint
CREATE TABLE `paper_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`symbol_id` text NOT NULL,
	`side` text NOT NULL,
	`type` text NOT NULL,
	`qty` real NOT NULL,
	`price` real,
	`stop_loss` real,
	`take_profit` real,
	`status` text NOT NULL,
	`reason` text,
	`note` text DEFAULT '' NOT NULL,
	`ref_price` real,
	`created_at` integer NOT NULL,
	`filled_at` integer,
	`fill_price` real,
	`generation` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `paper_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_orders_account_idx` ON `paper_orders` (`account_id`,`status`);--> statement-breakpoint
CREATE TABLE `paper_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` integer NOT NULL,
	`symbol_id` text NOT NULL,
	`market` text NOT NULL,
	`currency` text NOT NULL,
	`point_value` real NOT NULL,
	`tick` real NOT NULL,
	`qty` real NOT NULL,
	`max_qty` real NOT NULL,
	`avg_price` real NOT NULL,
	`stop` real,
	`target` real,
	`initial_stop` real,
	`entry_fx` real NOT NULL,
	`cost_brl` real NOT NULL,
	`realized_brl` real DEFAULT 0 NOT NULL,
	`fees_brl` real DEFAULT 0 NOT NULL,
	`sales_brl` real DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`opened_at` integer NOT NULL,
	`closed_at` integer,
	`delay_note` text,
	`generation` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `paper_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `paper_positions_account_idx` ON `paper_positions` (`account_id`,`status`);