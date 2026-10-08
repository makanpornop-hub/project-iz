INSERT INTO case_statuses(id) VALUES ('Contract signing') ON CONFLICT DO NOTHING;
INSERT INTO system_settings(id,value) VALUES ('case_form','{"revision":1,"required":["country","visa_type"]}') ON CONFLICT DO NOTHING;
