-- Supabase migration SQL to add form_schema_id column to form_schema_history if needed.

DO $$
BEGIN
    -- Check if the column exists
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name='form_schema_history' AND column_name='form_schema_id') THEN
        -- Column already exists, nothing to do
        NULL;
    ELSE
        -- Column doesn't exist, add the new form_schema_id column
        EXECUTE 'ALTER TABLE public.form_schema_history ADD COLUMN form_schema_id uuid';
    END IF;
END $$;
