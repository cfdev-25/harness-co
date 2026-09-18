-- A system prompt is not a memory: it is the instruction preamble, and it must
-- render before anything else. Memories were carrying this job implicitly.
--
-- Note what adding a kind now costs: one row. No constraint change, no wire
-- format change, no client change. That was the point of 0013.
insert into asset_kinds(kind, description) values
  ('prompt', 'Instruction preamble rendered ahead of memories');
