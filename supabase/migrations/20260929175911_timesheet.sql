CREATE TABLE "timesheet" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid DEFAULT auth.uid(),
	"legacy_ref" text,
	"assignment_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"hours" numeric(6, 2) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	CONSTRAINT "timesheet_legacy_ref_key" UNIQUE("legacy_ref"),
	CONSTRAINT "timesheet_assignment_period_key" UNIQUE("assignment_id","period_id"),
	CONSTRAINT "timesheet_hours_check" CHECK ("timesheet"."hours" >= 0),
	CONSTRAINT "timesheet_source_check" CHECK ("timesheet"."source" in ('manual', 'import'))
);
--> statement-breakpoint
ALTER TABLE "timesheet" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_assignment_id_assignment_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet" ADD CONSTRAINT "timesheet_period_id_period_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."period"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "timesheet_select" ON "timesheet" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "timesheet_insert" ON "timesheet" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "timesheet_update" ON "timesheet" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance')) WITH CHECK ((select public.current_app_role()) in ('owner', 'finance'));--> statement-breakpoint
CREATE POLICY "timesheet_delete" ON "timesheet" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select public.current_app_role()) in ('owner', 'finance'));