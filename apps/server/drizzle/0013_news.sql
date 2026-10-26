CREATE TABLE `news_items` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`kind` text NOT NULL,
	`lang` text NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`snippet` text,
	`published_at` integer,
	`arrived_at` integer NOT NULL,
	`backlog` integer NOT NULL,
	`duplicate_of` text,
	`tags` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_items_source_url` ON `news_items` (`source_id`,`canonical_url`);--> statement-breakpoint
CREATE INDEX `news_items_arrived` ON `news_items` (`arrived_at`);--> statement-breakpoint
CREATE TABLE `news_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`etag` text,
	`last_modified` text,
	`first_poll_at` integer,
	`last_poll_at` integer,
	`last_ok_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `news_tags` (
	`news_id` text NOT NULL,
	`tag` text NOT NULL,
	PRIMARY KEY(`tag`, `news_id`),
	FOREIGN KEY (`news_id`) REFERENCES `news_items`(`id`) ON UPDATE no action ON DELETE cascade
);
