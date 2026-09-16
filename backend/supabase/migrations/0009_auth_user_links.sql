alter table org_unit_members
  add constraint org_unit_members_auth_user_fk
  foreign key (auth_user_id) references auth.users(id) on delete cascade;

alter table org_unit_admins
  add constraint org_unit_admins_auth_user_fk
  foreign key (auth_user_id) references auth.users(id) on delete cascade;

alter table personal_access_tokens
  add constraint personal_access_tokens_auth_user_fk
  foreign key (auth_user_id) references auth.users(id) on delete cascade;
