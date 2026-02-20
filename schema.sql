create schema :ns;

create function :ns.block_sz() returns int as $$
  select :sz;
$$ language sql;

create table :ns.inodes (
  id bigserial not null primary key,
  parent bigint null,
  type int not null,
  nlink int not null,
  name varchar(1024) not null,
  create_ms bigint not null,
  modify_ms bigint not null,
  access_ms bigint not null,
  size bigint not null default 0,
  mode int not null,
  uid int not null,
  gid int not null,
  flags int not null default 0,
  path varchar(1024) null,
  foreign key (parent) references :ns.inodes (id) on delete cascade,
  constraint inode_name_unique unique (parent, name)
);

create table :ns.blocks (
  id bigserial not null primary key,
  ino bigint not null,
  num bigint not null,
  buf bytea not null,
  foreign key (ino) references :ns.inodes (id) on delete cascade,
  constraint block_num_unique unique (ino, num)
);

create index blocks_ino_num_idx on :ns.blocks(ino, num);

create table :ns.links (
  id bigserial not null primary key,
  ino bigint not null,
  parent bigint null,
  name varchar(1024) not null,
  foreign key (ino) references :ns.inodes (id) on delete cascade,
  foreign key (parent) references :ns.inodes (id) on delete cascade,
  constraint link_name_unique unique (parent, name)
);

create view :ns.inodes_and_links as
  select i.id, i.parent, i.type, i.nlink, i.name, i.create_ms, i.modify_ms, i.access_ms, i.size, i.mode, i.uid, i.gid, i.flags, i.path
  from :ns.inodes as i
  union all
  select i.id, l.parent, i.type, i.nlink, l.name, i.create_ms, i.modify_ms, i.access_ms, i.size, i.mode, i.uid, i.gid, i.flags, i.path
  from :ns.inodes as i
  join :ns.links as l
    on l.ino = i.id;

create function :ns.mknod(p bigint, n varchar(1024), t int, nl int, ms bigint, sz bigint, mo int, u int, g int, pth varchar(1024))
returns setof :ns.inodes
as $$
declare
  c int := 0;
  i bigint;
begin
  select count(id) into c from :ns.inodes where type = 1 and id = p;
  if c <= 0 then
    raise exception 'Mknod = not_found';
  end if;
  select count(id) into c from :ns.inodes where parent = p and name = n;
  if c >= 1 then
    raise exception 'Mknod = file_exists';
  end if;
  insert into :ns.inodes
    (parent, name, type, nlink, create_ms, modify_ms, access_ms, size, mode, uid, gid, path)
      values (p, n, t, nl, ms, ms, ms, sz, mo, u, g, pth) returning id into i;
  if t = 1 then
    update :ns.inodes SET nlink = nlink + 1 WHERE id = p;
  end if;
  return query select * from :ns.inodes where id = i;
end;
$$ language plpgsql;

create function :ns.setattr(i bigint, c bigint, m bigint, a bigint, sz bigint, mo int, u int, g int, f int, eb bigint)
returns setof :ns.inodes
as $$
begin
  update :ns.inodes SET create_ms = c, modify_ms = m, access_ms = a, size = sz, mode = mo, uid = u, gid = g, flags = f WHERE id = i;
  if not found then
    raise exception 'Set attr = not_found';
  end if;
  delete from :ns.blocks where ino = i and num >= eb;
  return query select * from :ns.inodes where id = i;
end;
$$ language plpgsql;

create function :ns.write(i bigint, n bigint, b bytea, sz bigint)
returns int
as $$
begin
  insert into :ns.blocks (ino, num, buf) values (i, n, b)
    on conflict (ino, num) do update
      set buf = b;
  update :ns.inodes set size = sz where sz >= 0 and id = i;
  return 1;
end;
$$ language plpgsql;

create function :ns.link(i bigint, p bigint, n varchar(1024))
returns setof :ns.inodes
as $$
declare
  c int := 0;
begin
  select count(id) into c from :ns.inodes_and_links where (type = 1 and id = p) or (type = 2 and id = i);
  if c < 2 then
    raise exception 'Link = not_found';
  end if;
  select count(id) into c from :ns.inodes_and_links where parent = p and name = n;
  if c >= 1 then
    raise exception 'Link = file_exists';
  end if;
  insert into :ns.links (ino, parent, name) values (i, p, n);
  update :ns.inodes set nlink = nlink + 1 where id = i;
  return query select * from :ns.inodes_and_links where parent = p and name = n;
end;
$$ language plpgsql;

create function :ns.unlink(p bigint, n varchar(1024))
returns setof :ns.inodes
as $$
declare
  c int := 0;
  rand varchar(1024);
  i bigint;
begin
  select count(id) into c from :ns.inodes where type = 1 and parent = p and name = n;
  if c >= 1 then
    raise exception 'Unlink = is_dir';
  end if;
  c := 0;
  select substr(md5(random()::text), 1, 64) into rand;
  update :ns.inodes set parent = null, name = rand where parent = p and name = n;
  if found then
    c := c + 1;
  end if;
  update :ns.links set parent = null, name = rand where parent = p and name = n;
  if found then
    c := c + 1;
  end if;
  if c <= 0 then
    raise exception 'Unlink = not_found';
  end if;
  select id into i from :ns.inodes_and_links where name = rand;
  update :ns.inodes set nlink = nlink - 1 where id = i;
  return query select * from :ns.inodes_and_links where name = rand;
end;
$$ language plpgsql;

create function :ns.rmdir(p bigint, n varchar(1024))
returns setof :ns.inodes
as $$
declare
  i bigint;
  t int;
  c int := 0;
  rand varchar(1024);
begin
  select id, type into i, t from :ns.inodes where parent = p and name = n;
  if not found then
    raise exception 'Rmdir = not_found';
  end if;
  if t != 1 then
    raise exception 'Rmdir = not_dir';
  end if;
  select count(id) into c from :ns.inodes_and_links where parent = i;
  if c >= 1 then
    raise exception 'Rmdir = not_empty';
  end if;
  select substr(md5(random()::text), 1, 64) into rand;
  update :ns.inodes set parent = null, name = rand, nlink = 0 where id = i;
  update :ns.inodes set nlink = nlink - 1 where id = p;
  return query select * from :ns.inodes where id = i;
end;
$$ language plpgsql;

-- allow replace (p2, n2)
create function :ns.rename(p1 bigint, n1 varchar(1024), p2 bigint, n2 varchar(1024))
returns setof :ns.inodes
as $$
declare
  t int;
  c int := 0;
  ino bigint := 0;
  rand varchar(1024);
begin
  select type into t from :ns.inodes_and_links where parent = p1 and name = n1;
  if not found then
    raise exception 'Rename = not_found';
  end if;
  select count(id) into c from :ns.inodes where type = 1 and id = p2;
  if c <= 0 then
    raise exception 'Rename = not_found';
  end if;
  select id into ino from :ns.inodes_and_links where parent = p2 and name = n2;
  if found then
    update :ns.inodes set nlink = nlink - 1 where id = ino;
  end if;
  select substr(md5(random()::text), 1, 64) into rand;
  update :ns.inodes set parent = null, name = rand where parent = p2 and name = n2;
  update :ns.links set parent = null, name = rand where parent = p2 and name = n2;
  update :ns.inodes set parent = p2, name = n2 WHERE parent = p1 AND name = n1;
  update :ns.links set parent = p2, name = n2 WHERE parent = p1 AND name = n1;
  if t = 1 then
    update :ns.inodes set nlink = nlink - 1 where parent = p1;
    update :ns.inodes set nlink = nlink + 1 where parent = p2;
  end if;
  return query select * from :ns.inodes_and_links where parent = p2 and name = n2;
end;
$$ language plpgsql;

insert into :ns.inodes (parent, type, nlink, name, create_ms, modify_ms, access_ms, size, mode, uid, gid)
  values (
    null,
    1,
    2,
    'root',
    (select extract(epoch from now()) * 1000),
    (select extract(epoch from now()) * 1000),
    (select extract(epoch from now()) * 1000),
    4096,
    509,
    1000,
    1000
  );
