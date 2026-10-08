create table tenants (
  slug    text primary key,
  name    text not null,
  db_name text not null unique
);
