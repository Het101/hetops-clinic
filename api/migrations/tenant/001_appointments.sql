create table appointments (
  id         bigserial primary key,
  patient    text not null,
  at         timestamptz not null,
  reminded   boolean not null default false,
  created_at timestamptz not null default now()
);
create table reports (
  day          date primary key,
  appointments integer not null
);
