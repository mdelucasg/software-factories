CREATE TABLE `notification_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`comments_enabled` integer DEFAULT true NOT NULL,
	`seat_claimed_enabled` integer DEFAULT true NOT NULL,
	`purchase_digest_frequency` text DEFAULT 'daily' NOT NULL,
	`adherence_reminders_enabled` integer DEFAULT true NOT NULL,
	`course_recommendations_enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
