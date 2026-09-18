-- These three were schema without behaviour: nothing metered spend, nothing
-- ever set a retention date, and legal hold only guarded a delete the user
-- could already not reach. A column that looks like a feature is worse than an
-- absent one. Re-add them with the code that implements them.
alter table harness_sessions
  drop column if exists legal_hold,
  drop column if exists retention_until;
