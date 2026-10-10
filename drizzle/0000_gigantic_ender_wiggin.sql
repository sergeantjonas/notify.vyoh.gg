CREATE TABLE "message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"url" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "message_source_key" UNIQUE("source","key")
);
--> statement-breakpoint
CREATE INDEX "message_undelivered_idx" ON "message" USING btree ("received_at") WHERE "message"."delivered_at" is null;