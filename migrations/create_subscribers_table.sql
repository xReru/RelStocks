-- Create subscribers table
CREATE TABLE IF NOT EXISTS subscribers (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscribers_user_id ON subscribers(user_id);

-- Create function to create subscribers table
CREATE OR REPLACE FUNCTION create_subscribers_table()
RETURNS void AS $$
BEGIN
    -- Table creation is handled by the migration above
    -- This function exists to be called from the application
    RETURN;
END;
$$ LANGUAGE plpgsql; 