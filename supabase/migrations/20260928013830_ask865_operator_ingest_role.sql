-- Restricted login for existing operator-run Shop-Ware/Tekmetric import tools.
-- Password is provisioned separately and never stored in migration history.
CREATE ROLE ask865_operator NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;
GRANT ask865_operator TO postgres;
GRANT ask865_ingest TO ask865_operator;
ALTER ROLE ask865_operator SET statement_timeout = '90s';
ALTER ROLE ask865_operator SET idle_in_transaction_session_timeout = '30s';
