CREATE OR REPLACE FUNCTION forbid_admin_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_admin_audit_log_mutation();

CREATE TRIGGER admin_audit_log_no_delete
  BEFORE DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_admin_audit_log_mutation();
