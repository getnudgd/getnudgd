CREATE OR REPLACE FUNCTION forbid_request_events_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'request_events is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER request_events_no_update
  BEFORE UPDATE ON request_events
  FOR EACH ROW EXECUTE FUNCTION forbid_request_events_mutation();

CREATE TRIGGER request_events_no_delete
  BEFORE DELETE ON request_events
  FOR EACH ROW EXECUTE FUNCTION forbid_request_events_mutation();
