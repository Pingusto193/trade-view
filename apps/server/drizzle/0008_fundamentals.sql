CREATE TABLE `fundamental_facts` (
	`source` text NOT NULL,
	`entity` text NOT NULL,
	`metric` text NOT NULL,
	`concept` text NOT NULL,
	`rank` integer NOT NULL,
	`start` integer NOT NULL,
	`end` integer NOT NULL,
	`value` real NOT NULL,
	`doc` text NOT NULL,
	`filed` integer,
	PRIMARY KEY(`source`, `entity`, `concept`, `start`, `end`, `doc`)
);
--> statement-breakpoint
CREATE INDEX `fundamental_facts_entity_idx` ON `fundamental_facts` (`source`,`entity`);--> statement-breakpoint
CREATE TABLE `fundamental_tickers` (
	`source` text NOT NULL,
	`ticker` text NOT NULL,
	`entity` text NOT NULL,
	`name` text,
	`share_class` text,
	PRIMARY KEY(`source`, `ticker`)
);
