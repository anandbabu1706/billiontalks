INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at) SELECT 'listing-'||id,'JOB',company||'/'||listing,reporter,reason,'MEDIUM','OPEN',at,at FROM listing_reports;
-- break
INSERT INTO moderation_events(id,case_id,actor,action,public_status,internal_note,at) SELECT 'listing-'||id||'-submitted','listing-'||id,reporter,'SUBMITTED','OPEN',detail,at FROM listing_reports;
-- break
CREATE TRIGGER intake_listing_reports AFTER INSERT ON listing_reports BEGIN
 INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at) VALUES('listing-'||NEW.id,'JOB',NEW.company||'/'||NEW.listing,NEW.reporter,NEW.reason,'MEDIUM','OPEN',NEW.at,NEW.at);
 INSERT INTO moderation_events(id,case_id,actor,action,public_status,internal_note,at) VALUES('listing-'||NEW.id||'-submitted','listing-'||NEW.id,NEW.reporter,'SUBMITTED','OPEN',NEW.detail,NEW.at);
END;
-- break
INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at) SELECT 'company-'||id,'COMPANY',company,reporter,reason,'MEDIUM','OPEN',at,at FROM company_reports;
-- break
INSERT INTO moderation_events(id,case_id,actor,action,public_status,internal_note,at) SELECT 'company-'||id||'-submitted','company-'||id,reporter,'SUBMITTED','OPEN',detail,at FROM company_reports;
-- break
CREATE TRIGGER intake_company_reports AFTER INSERT ON company_reports BEGIN
 INSERT INTO moderation_cases(id,kind,target_ref,reporter,category,severity,status,created_at,updated_at) VALUES('company-'||NEW.id,'COMPANY',NEW.company,NEW.reporter,NEW.reason,'MEDIUM','OPEN',NEW.at,NEW.at);
 INSERT INTO moderation_events(id,case_id,actor,action,public_status,internal_note,at) VALUES('company-'||NEW.id||'-submitted','company-'||NEW.id,NEW.reporter,'SUBMITTED','OPEN',NEW.detail,NEW.at);
END;
-- break
CREATE TRIGGER erase_report_details AFTER INSERT ON jobs_subject_deletions BEGIN
 UPDATE company_reports SET detail='' WHERE reporter=NEW.subject;
 UPDATE listing_reports SET detail='' WHERE reporter=NEW.subject;
 UPDATE ownership_recovery_cases SET evidence_ref='removed',decision=NULL WHERE requester=NEW.subject AND status='CLOSED';
END;
-- break
CREATE VIEW current_jobs_enforcement AS SELECT target_kind,target_ref,kind FROM enforcement_actions
 WHERE revoked_at IS NULL AND starts_at<=unixepoch('subsec')*1000
 AND (expires_at IS NULL OR expires_at>unixepoch('subsec')*1000);
