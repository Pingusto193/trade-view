CREATE TABLE `predict_targets` (
	`user_id` integer NOT NULL,
	`symbol_id` text NOT NULL,
	`tf` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `symbol_id`, `tf`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `predictions` (
	`id` text PRIMARY KEY NOT NULL,
	`symbol_id` text NOT NULL,
	`tf` text NOT NULL,
	`horizon` integer NOT NULL,
	`method` text NOT NULL,
	`candle_time` integer NOT NULL,
	`created_at` integer NOT NULL,
	`close` real NOT NULL,
	`p` real NOT NULL,
	`always_up_p` real NOT NULL,
	`persist_up` integer,
	`detail` text NOT NULL,
	`status` text DEFAULT 'aberta' NOT NULL,
	`resolved_at` integer,
	`target_time` integer,
	`target_close` real,
	`up` integer,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `predictions_key` ON `predictions` (`symbol_id`,`tf`,`horizon`,`method`,`candle_time`);--> statement-breakpoint
CREATE INDEX `predictions_status` ON `predictions` (`status`);--> statement-breakpoint
-- placar honesto (ADR-0033): o que foi previsto não muda, conferência só uma vez, nada se apaga
CREATE TRIGGER `predictions_frozen` BEFORE UPDATE OF `id`, `symbol_id`, `tf`, `horizon`, `method`, `candle_time`, `created_at`, `close`, `p`, `always_up_p`, `persist_up`, `detail` ON `predictions`
BEGIN SELECT RAISE(ABORT, 'previsão gravada não pode ser alterada'); END;
--> statement-breakpoint
CREATE TRIGGER `predictions_resolve_once` BEFORE UPDATE ON `predictions` WHEN OLD.`status` <> 'aberta'
BEGIN SELECT RAISE(ABORT, 'previsão já conferida ou cancelada'); END;
--> statement-breakpoint
CREATE TRIGGER `predictions_no_delete` BEFORE DELETE ON `predictions`
BEGIN SELECT RAISE(ABORT, 'previsões não podem ser apagadas'); END;
