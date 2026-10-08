INSERT INTO case_statuses(id) VALUES
('Contract signing'),('Waiting for payment'),('Documents collecting'),
('Under review'),('Ready for submission'),('Waiting for decision'),
('Visa approved'),('Additional request'),('Visa refused')
ON CONFLICT DO NOTHING;

WITH changed AS (
  UPDATE cases c SET status=m.next_status,revision=c.revision+1,updated_at=now()
  FROM (VALUES ('New','Contract signing'),('Application submitted','Waiting for decision'),
               ('Completed','Visa approved'),('Cancelled','Visa refused')) m(previous_status,next_status)
  WHERE c.status=m.previous_status
  RETURNING c.id,m.previous_status,c.status
)
INSERT INTO audit_logs(action,entity,entity_id,case_id,source,detail)
SELECT 'Обновлён список этапов дела','case',id::text,id,'migration',
       jsonb_build_object('from',previous_status,'to',status) FROM changed;

ALTER TABLE cases ALTER COLUMN status SET DEFAULT 'Contract signing';
DELETE FROM case_statuses WHERE id IN ('New','Application submitted','Completed','Cancelled');
