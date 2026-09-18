-- 0015 added a kind called `prompt` whose own comment called it a system
-- prompt. The name was the mistake: to everyone outside this repo a "prompt"
-- is the thing you type, so a tab called Prompts holding standing
-- instructions is a fight with the reader that we lose every time.
--
-- `prompt` therefore becomes `system_prompt`, and the freed word takes the
-- meaning people already expect: a saved paragraph you call up by name
-- instead of retyping it. The agent has always loaded those from its
-- `prompts/` directory and offered them as `/name`, so this adds a kind that
-- reaches an existing capability rather than a capability.
insert into asset_kinds(kind, description) values
  ('system_prompt', 'Standing instructions placed ahead of everything else in a session');

update assets set kind = 'system_prompt' where kind = 'prompt';

update asset_kinds
   set description = 'A saved instruction the user calls up by name, as /name'
 where kind = 'prompt';
