-- Supabase migration SQL to rename or add the form_schema_id column.

-- Check if the column exists, and rename it if it does.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='form_schema_history' AND column_name='current_column_name') THEN
        EXECUTE 'ALTER TABLE public.form_schema_history RENAME COLUMN current_column_name TO form_schema_id';
    ELSE
        -- Column doesn't exist, add the new form_schema_id column
        EXECUTE 'ALTER TABLE public.form_schema_history ADD COLUMN form_schema_id uuid';
        -- Backfill form_schema_id from the existing FK column
        EXECUTE 'UPDATE public.form_schema_history SET form_schema_id = existing_fk_column';
    END IF;
    -- Add the foreign key constraint
    ALTER TABLE public.form_schema_history ADD CONSTRAINT fk_form_schema FOREIGN KEY (form_schema_id) REFERENCES public.form_schemas(id);
END $$;