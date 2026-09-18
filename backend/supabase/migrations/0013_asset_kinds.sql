-- A kind was a CHECK constraint, a Literal in the API, and a fixed array in
-- the manifest. Adding one meant a migration plus a change to every client.
-- It is now a row: the storage layer only ever cared about a name and its
-- versioned files, so nothing else about an asset is kind-specific.
create table asset_kinds (
  kind text primary key,
  description text not null
);

insert into asset_kinds(kind, description) values
  ('skill',      'A capability the agent can apply, as a folder with SKILL.md'),
  ('memory',     'Standing context rendered into the agent''s instructions'),
  ('tool',       'An executable the agent may run, as a folder with run'),
  ('connection', 'A model or service the agent may reach');

alter table assets drop constraint if exists assets_kind_check;
alter table assets add constraint assets_kind_fk
  foreign key (kind) references asset_kinds(kind);
