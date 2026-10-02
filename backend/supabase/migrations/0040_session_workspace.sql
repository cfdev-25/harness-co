-- W5-D14: a session remembers where it ran. `harness open` puts a person in a
-- folder and starts the session there, so the card can offer *open again in
-- ~/projects/foo* — but the page cannot know which machine the browser is on,
-- so the machine's name travels with the path. Both are nullable: a CLI one
-- version behind sends neither and still opens a session (engine 00 §4.10).
-- Read back by the owner alone (console 04 §4): nobody reads another person's
-- paths, not even an admin, not even under `?as`.
alter table harness_sessions add column if not exists workspace text;
alter table harness_sessions add column if not exists hostname text;
