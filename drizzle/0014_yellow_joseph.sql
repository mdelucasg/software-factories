ALTER TABLE `courses` ADD `first_published_at` text;
--> statement-breakpoint
UPDATE `courses` SET `first_published_at` = `created_at` WHERE `status` = 'published' AND `first_published_at` IS NULL;
