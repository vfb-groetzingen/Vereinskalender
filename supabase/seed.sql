-- Startdaten: Ressourcen und Kategorien (entsprechend data/seed.json).
-- Mehrfach ausführbar.
insert into public.categories (name, color) values
  ('Training', '#2b6cb0'),
  ('Spiel', '#b83232'),
  ('Veranstaltung', '#276749'),
  ('Vermietung', '#8a5300'),
  ('Sitzung', '#6b46c1'),
  ('Sonstiges', '#4a5568')
on conflict (name) do update set color = excluded.color;

insert into public.resources (slug, name, type, color, sort_order) values
  ('besprechungszimmer', 'Besprechungszimmer', 'raum', '#8e44ad', 1),
  ('jugendraum', 'Jugendraum', 'raum', '#a3286b', 2),
  ('platz-1-hauptplatz', 'Platz 1 - Hauptplatz', 'platz', '#1f5fa8', 3),
  ('trainingsplatz-a', 'Trainingsplatz A', 'platz', '#6b46c1', 4),
  ('trainingsplatz-b', 'Trainingsplatz B', 'platz', '#6b4a1e', 5),
  ('kunstrasenplatz', 'Kunstrasenplatz', 'platz', '#276749', 6),
  ('parkplatz', 'Parkplatz', 'platz', '#9c5b00', 7)
on conflict (slug) do update set name = excluded.name, type = excluded.type,
  color = excluded.color, sort_order = excluded.sort_order;
