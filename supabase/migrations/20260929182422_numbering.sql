CREATE TABLE "number_sequence" (
	"key" text PRIMARY KEY NOT NULL,
	"template" text NOT NULL,
	"next_value" integer DEFAULT 1 NOT NULL,
	"year_scoped" boolean DEFAULT false NOT NULL,
	"current_year" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	CONSTRAINT "number_sequence_next_value_check" CHECK ("number_sequence"."next_value" >= 1),
	CONSTRAINT "number_sequence_template_check" CHECK ("number_sequence"."template" like '%{seq}%')
);
--> statement-breakpoint
ALTER TABLE "number_sequence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_calendar_exception" (
	"on_date" date PRIMARY KEY NOT NULL,
	"is_working" boolean NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	CONSTRAINT "work_calendar_exception_reason_check" CHECK (length(trim("work_calendar_exception"."reason")) > 0)
);
--> statement-breakpoint
ALTER TABLE "work_calendar_exception" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_number_sequence_key_number_sequence_key_fk" FOREIGN KEY ("number_sequence_key") REFERENCES "public"."number_sequence"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "number_sequence_select" ON "number_sequence" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "number_sequence_insert" ON "number_sequence" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "number_sequence_update" ON "number_sequence" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) = 'owner') WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "number_sequence_delete" ON "number_sequence" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "work_calendar_exception_select" ON "work_calendar_exception" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) is not null);--> statement-breakpoint
CREATE POLICY "work_calendar_exception_insert" ON "work_calendar_exception" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "work_calendar_exception_update" ON "work_calendar_exception" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) = 'owner') WITH CHECK ((select public.current_app_role()) = 'owner');--> statement-breakpoint
CREATE POLICY "work_calendar_exception_delete" ON "work_calendar_exception" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) = 'owner');