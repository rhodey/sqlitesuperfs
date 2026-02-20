use log::debug;
use log::error;
use log::{info, log_enabled, Level};

use std::fmt;
use std::error::Error;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use postgres::Row;
use postgres::{Client, NoTls};
use postgres::{Error as PgError};
use thiserror::Error;

use std::ffi::OsString;
use std::os::unix::ffi::OsStringExt;
use base64::{engine::general_purpose, Engine as _};

use libc::c_int;
use libsodium_rs::crypto_generichash;
use libsodium_rs::crypto_secretbox;
use libsodium_rs::crypto_secretbox::Key;
use libsodium_rs::crypto_secretbox::Nonce;

use crate::fs::Inode;
use crate::fs::Block;

use std::{thread, time::Duration};

pub struct PgDb {
  uid: u32,
  gid: u32,
  sql_url: String,
  namespace: String,
  conn: Option<Client>,
  enc_key: Key,
}

fn get_u64(row: &postgres::Row, col: &str) -> u64 {
  row.get::<_, i64>(col).try_into().unwrap()
}

fn get_u32(row: &postgres::Row, col: &str) -> u32 {
  row.get::<_, i32>(col).try_into().unwrap()
}

fn get_opt_u64(opt: Option<i64>) -> Option<u64> {
  let mut res: Option<u64> = None;
  match opt {
    Some(ino) => { res = Some(ino.try_into().unwrap()); }
    _ => { }
  }
  res
}

// file names not always utf8
fn b64_decode(ino: u64, b64: &str) -> OsString {
  let bytes = match general_purpose::STANDARD.decode(b64) {
    Ok(bytes) => bytes,
    Err(_e) => panic!("(b64_decode) {}", ino)
  };
  OsString::from_vec(bytes)
}

fn get_inode(row: &Row) -> Inode {
  let id: u64 = get_u64(row, "id");
  let parent: Option<i64> = row.get("parent");
  let parent = get_opt_u64(parent);
  let name = b64_decode(id, row.get("name"));
  let path: Option<String> = row.get("path");
  let path: Option<OsString> = match path {
    Some(path) => Some(b64_decode(id, &path)),
    None => None
  };
  return Inode {
    id, parent, name,
    typee: get_u32(row, "type"),
    nlink: get_u32(row, "nlink"),
    create_ms: get_u64(row, "create_ms"),
    modify_ms: get_u64(row, "modify_ms"),
    access_ms: get_u64(row, "access_ms"),
    size: get_u64(row, "size"),
    mode: get_u32(row, "mode"),
    uid: get_u32(row, "uid"),
    gid: get_u32(row, "gid"),
    flags: get_u32(row, "flags"),
    path, open: 0,
  }
}

fn get_block(row: &Row) -> Block {
  return Block {
    ino: get_u64(row, "ino"),
    num: get_u64(row, "num"),
    buf: row.get("buf"),
    ino_sz: -1,
  }
}

#[derive(Debug)]
pub struct PgPretty(pub PgError);

impl fmt::Display for PgPretty {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    if let Some(db) = self.0.as_db_error() {
      return write!(f, "{}", db.message());
    }
    write!(f, "db error")
  }
}

impl Error for PgPretty {
  fn source(&self) -> Option<&(dyn Error + 'static)> {
    Some(&self.0)
  }
}

#[derive(Debug, Error)]
pub enum PgErr {
  #[error(transparent)]
  Db(#[from] PgPretty),
  #[error(transparent)]
  Other(#[from] anyhow::Error),
}

fn not_found(e: &postgres::error::Error) -> bool {
  match e.as_db_error() {
    Some(e) if e.message().contains("not_found") => true,
    _ => false,
  }
}

fn not_dir(e: &postgres::error::Error) -> bool {
  match e.as_db_error() {
    Some(e) if e.message().contains("not_dir") => true,
    _ => false,
  }
}

fn not_empty(e: &postgres::error::Error) -> bool {
  match e.as_db_error() {
    Some(e) if e.message().contains("not_empty") => true,
    _ => false,
  }
}

fn file_exists(e: &postgres::error::Error) -> bool {
  match e.as_db_error() {
    Some(e) if e.message().contains("file_exists") => true,
    _ => false,
  }
}

fn is_dir(e: &postgres::error::Error) -> bool {
  match e.as_db_error() {
    Some(e) if e.message().contains("is_dir") => true,
    _ => false,
  }
}

// todo: stack
fn db_err(op: &str, err: PgPretty) -> c_int {
  error!("db err ({}) {}", op, err);
  libc::EIO
}

// todo: stack
fn db_panic(op: &str, err: PgPretty) -> c_int {
  panic!("db panic ({}) {}", op, err);
}

// simulate network
fn do_sleep() {
  if log_enabled!(Level::Info) { thread::sleep(Duration::from_micros(200)); }
}

const SCHEMA: &str = include_str!("../../schema.sql");

impl PgDb {

  pub fn new(uid: u32, gid: u32, sql_url: &str, namespace: &str, enc_pass: &str) -> Self {
    let enc_key = crypto_generichash::generichash(enc_pass.as_bytes(), None, 32).expect("db panic (generichash)");
    let enc_key = Key::from_bytes(&enc_key).expect("db panic (key_from_bytes)");
    PgDb {
      uid, gid,
      sql_url: sql_url.to_string(),
      namespace: namespace.to_string(),
      conn: None,
      enc_key,
    }
  }

  pub fn get_conn(&mut self) -> Result<&mut Client, c_int> {
    let new_conn = match self.conn.as_ref() {
      None => true,
      Some(conn) => conn.is_closed(),
    };
    if new_conn {
      let conn = Client::connect(&self.sql_url, NoTls)
        .map_err(|e| db_err("get_conn", PgPretty(e)))?;
      self.conn = Some(conn);
    }
    self.conn.as_mut().ok_or(libc::EIO)
  }

  pub fn init(&mut self, schemaa: Option<String>, block_sz: u64) -> Result<u64, c_int> {
    let schema = if schemaa.is_some() {
      schemaa.unwrap().clone()
    } else {
      SCHEMA.to_owned()
    };
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let query = format!("SELECT {}.block_sz() AS sz", &ns);
    match conn.query_one(&query, &[]) {
      Ok(row) => {
        let sz: i32 = row.get("sz");
        let sz: u64 = sz.try_into().unwrap();
        debug!("schema exists");
        debug!("{}", sz);
        let query = format!("DELETE FROM {}.inodes WHERE nlink <= 0", &ns);
        let count = match conn.execute(&query, &[]) {
          Ok(c) => c,
          Err(e) => return Err(db_err("init_schema", PgPretty(e))),
        };
        debug!("deleted {}", count);
        Ok(sz)
      },
      Err(e) => {
        let e = PgPretty(e);
        let es = format!("{}", e);
        let find = format!("schema \"{}\" does not exist", &ns);
        if es.contains(&find) == false {
          return Err(db_err("init_schema", e))
        }
        let schema = schema.replace(":ns", &ns);
        let sz = format!("{}", &block_sz);
        let schema = schema.replace(":sz", &sz);
        if let Err(e) = conn.batch_execute(&schema) {
          return Err(db_err("init_schema", PgPretty(e)));
        }
        let row = match conn.query_one(&query, &[]) {
          Ok(row) => row,
          Err(e) => return Err(db_err("init_schema", PgPretty(e))),
        };
        let sz: i32 = row.get("sz");
        let sz: u64 = sz.try_into().unwrap();
        debug!("schema ok");
        debug!("{}", sz);
        Ok(sz)
      },
    }
  }

  fn encrypt(&mut self, buf: Vec<u8>) -> Vec<u8> {
    let key = &self.enc_key;
    let nonce = Nonce::generate();
    let encrypted = crypto_secretbox::seal(&buf, &nonce, &key);
    let buf = [nonce.as_bytes(), encrypted.as_slice()].concat();
    buf
  }

  fn decrypt(&mut self, buf: Vec<u8>) -> Vec<u8> {
    let key = &self.enc_key;
    let len = crypto_secretbox::NONCEBYTES;
    let nonce = Nonce::try_from_slice(&buf[0..len]).expect("db panic (decrypt) nonce");
    let encrypted = &buf[len..];
    let decrypted = crypto_secretbox::open(&encrypted, &nonce, &key).expect("db panic (decrypt) open");
    decrypted
  }

  pub fn getattr(&mut self, ino: u64) -> Result<Option<Inode>, c_int> {
    info!("getattr");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let query = format!("SELECT * FROM {}.inodes_and_links WHERE id = $1", &ns);
    let ino: i64 = ino.try_into().unwrap();
    let rows = match conn.query(&query, &[&ino]) {
      Ok(rows) => rows,
      Err(e) => return Err(db_err("getattr", PgPretty(e))),
    };
    if rows.len() > 0 {
      let row = &rows[0];
      return Ok(Some(get_inode(row)));
    }
    Ok(None)
  }

  pub fn lookup(&mut self, parent: u64, name: &str) -> Result<Option<Inode>, c_int> {
    info!("lookup");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let parent: i64 = parent.try_into().unwrap();
    let query = format!("SELECT * FROM {}.inodes_and_links WHERE parent = $1 AND name = $2", &ns);
    let rows = match conn.query(&query, &[&parent, &name]) {
      Ok(rows) => rows,
      Err(e) => return Err(db_err("lookup", PgPretty(e))),
    };
    if rows.len() > 0 {
      let row = &rows[0];
      return Ok(Some(get_inode(row)));
    }
    Ok(None)
  }

  pub fn readdir(&mut self, ino: u64, offset: i64) -> Result<Vec<Inode>, c_int> {
    info!("readdir");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let ino: i64 = ino.try_into().unwrap();
    let offset: i64 = offset.try_into().unwrap();
    let query = format!("SELECT * FROM {}.inodes_and_links WHERE parent = $1 ORDER BY id OFFSET $2 LIMIT 256", &ns);
    let rows = match conn.query(&query, &[&ino, &offset]) {
      Ok(rows) => rows,
      Err(e) => return Err(db_err("readdir", PgPretty(e))),
    };
    let inodes = rows.iter().map(|row| {
      get_inode(&row)
    }).collect();
    Ok(inodes)
  }

  pub fn mknod(&mut self, parent: u64, name: &str, mode: u32, typee: u32, path: Option<&str>) -> Result<Inode, c_int> {
    info!("mknod");
    do_sleep();
    let uid = self.uid;
    let gid = self.gid;
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let ms = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("db panic (systime)")
      .as_millis() as i64;

    let p: i64 = parent.try_into().unwrap();
    let t: i32 = typee.try_into().unwrap();
    let mo: i32 = mode.try_into().unwrap();
    let u: i32 = uid.try_into().unwrap();
    let g: i32 = gid.try_into().unwrap();

    let sz: i64 = match path {
      Some(p) => p.len() as i64,
      None if t == 1 => 4096,
      _ => 0,
    };

    let nlink = if t == 1 {
      2 as i32
    } else {
      1 as i32
    };

    let query = format!("SELECT * FROM {}.mknod($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", &ns);
    let row = match conn.query_one(&query, &[&p, &name, &t, &nlink, &ms, &sz, &mo, &u, &g, &path]) {
      Ok(row) => row,
      Err(e) if not_found(&e) => return Err(libc::ENOENT),
      Err(e) if file_exists(&e) => return Err(libc::EEXIST),
      Err(e) => return Err(db_err("mknod", PgPretty(e))),
    };

    Ok(get_inode(&row))
  }

  pub fn setattr(&mut self, inode: Inode, end_block: u64) -> Result<Inode, c_int> {
    info!("setattr");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let c: i64 = inode.create_ms.try_into().unwrap();
    let m: i64 = inode.modify_ms.try_into().unwrap();
    let a: i64 = inode.access_ms.try_into().unwrap();
    let sz: i64 = inode.size.try_into().unwrap();
    let mo: i32 = inode.mode.try_into().unwrap();
    let u: i32 = inode.uid.try_into().unwrap();
    let g: i32 = inode.gid.try_into().unwrap();
    let f: i32 = inode.flags.try_into().unwrap();
    let id: i64 = inode.id.try_into().unwrap();
    let eb: i64 = end_block.try_into().unwrap();
    let query = format!("SELECT * FROM {}.setattr($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", &ns);
    let row = match conn.query_one(&query, &[&id, &c, &m, &a, &sz, &mo, &u, &g, &f, &eb]) {
      Ok(row) => row,
      Err(e) if not_found(&e) => return Err(libc::ENOENT),
      Err(e) => return Err(db_panic("setattr", PgPretty(e))),
    };
    Ok(get_inode(&row))
  }

  pub fn read(&mut self, ino: u64, start: u64, end: u64) -> Result<Vec<Block>, c_int> {
    info!("read {}", ino);
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let ino: i64 = ino.try_into().unwrap();
    let start: i64 = start.try_into().unwrap();
    let end: i64 = end.try_into().unwrap();
    let query = format!("SELECT * FROM {}.blocks WHERE ino = $1 AND num >= $2 AND num < $3", &ns);
    let rows = match conn.query(&query, &[&ino, &start, &end]) {
      Ok(rows) => rows,
      Err(e) => return Err(db_err("read", PgPretty(e))),
    };
    let blocks: Vec<Block> = rows.iter().map(|row| {
      get_block(&row)
    }).collect();
    let blocks = blocks.into_iter().map(|mut block| {
      let decrypted = self.decrypt(block.buf);
      block.buf = decrypted;
      block
    }).collect();
    Ok(blocks)
  }

  pub fn write(&mut self, blocks: Vec<Block>, attr: Option<Inode>, end_block: u64) -> Result<Option<Inode>, c_int> {
    info!("write");
    let blocks: Vec<Block> = blocks.into_iter().map(|mut block| {
      let encrypted = self.encrypt(block.buf);
      block.buf = encrypted;
      block
    }).collect();

    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    do_sleep();
    let mut txn = match conn.transaction() {
      Err(e) => return Err(db_err("write", PgPretty(e))),
      Ok(txn) => txn,
    };

    let mut inode: Option<Inode> = None;
    if let Some(attr) = attr {
      let c: i64 = attr.create_ms.try_into().unwrap();
      let m: i64 = attr.modify_ms.try_into().unwrap();
      let a: i64 = attr.access_ms.try_into().unwrap();
      let sz: i64 = attr.size.try_into().unwrap();
      let mo: i32 = attr.mode.try_into().unwrap();
      let u: i32 = attr.uid.try_into().unwrap();
      let g: i32 = attr.gid.try_into().unwrap();
      let f: i32 = attr.flags.try_into().unwrap();
      let id: i64 = attr.id.try_into().unwrap();
      let eb: i64 = end_block.try_into().unwrap();
      do_sleep();
      let query = format!("SELECT * FROM {}.setattr($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", &ns);
      let row = match txn.query_one(&query, &[&id, &c, &m, &a, &sz, &mo, &u, &g, &f, &eb]) {
        Ok(row) => row,
        Err(e) if not_found(&e) => return Err(libc::ENOENT),
        Err(e) => return Err(db_panic("write_setattr", PgPretty(e))),
      };
      inode = Some(get_inode(&row));
    }

    for block in blocks {
      let ino: i64 = block.ino.try_into().unwrap();
      let num: i64 = block.num.try_into().unwrap();
      let ino_sz: i64 = block.ino_sz;
      let buf = block.buf;
      info!("write {} {}", ino, num);
      do_sleep();
      let query = format!("SELECT {}.write($1, $2, $3, $4) AS ok", &ns);
      match txn.query_one(&query, &[&ino, &num, &buf, &ino_sz]) {
        Err(e) => return Err(db_panic("write", PgPretty(e))),
        Ok(_) => {},
      };
    }

    do_sleep();
    match txn.commit() {
      Err(e) => return Err(db_panic("write", PgPretty(e))),
      Ok(_) => {},
    };

    Ok(inode)
  }

  pub fn link(&mut self, ino: u64, new_parent: u64, new_name: &str) -> Result<Inode, c_int> {
    info!("link");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let query = format!("SELECT * FROM {}.link($1, $2, $3)", &ns);
    let id: i64 = ino.try_into().unwrap();
    let np: i64 = new_parent.try_into().unwrap();
    let row = match conn.query_one(&query, &[&id, &np, &new_name]) {
      Ok(row) => row,
      Err(e) if not_found(&e) => return Err(libc::ENOENT),
      Err(e) if file_exists(&e) => return Err(libc::EEXIST),
      Err(e) => return Err(db_err("link", PgPretty(e))),
    };
    Ok(get_inode(&row))
  }

  pub fn unlink(&mut self, parent: u64, name: &str) -> Result<Inode, c_int> {
    info!("unlink");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let query = format!("SELECT * FROM {}.unlink($1, $2)", &ns);
    let parent: i64 = parent.try_into().unwrap();
    let row = match conn.query_one(&query, &[&parent, &name]) {
      Ok(row) => row,
      Err(e) if is_dir(&e) => return Err(libc::EISDIR),
      Err(e) if not_found(&e) => return Err(libc::ENOENT),
      Err(e) => return Err(db_panic("unlink", PgPretty(e))),
    };
    Ok(get_inode(&row))
  }

  pub fn rmdir(&mut self, parent: u64, name: &str) -> Result<Inode, c_int> {
    info!("rmdir");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let query = format!("SELECT * FROM {}.rmdir($1, $2) AS err", &ns);
    let parent: i64 = parent.try_into().unwrap();
    let row = match conn.query_one(&query, &[&parent, &name]) {
      Ok(row) => row,
      Err(e) if not_found(&e) => return Err(libc::ENOENT),
      Err(e) if not_dir(&e) => return Err(libc::ENOTDIR),
      Err(e) if not_empty(&e) => return Err(libc::ENOTEMPTY),
      Err(e) => return Err(db_panic("rmdir", PgPretty(e))),
    };
    Ok(get_inode(&row))
  }

  pub fn rename(&mut self, parent: u64, name: &str, new_parent: u64, new_name: &str) -> Result<Inode, c_int> {
    info!("rename");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let query = format!("SELECT * FROM {}.rename($1, $2, $3, $4)", &ns);
    let parent: i64 = parent.try_into().unwrap();
    let new_parent: i64 = new_parent.try_into().unwrap();
    let row = match conn.query_one(&query, &[&parent, &name, &new_parent, &new_name]) {
      Ok(row) => row,
      Err(e) if not_found(&e) => return Err(libc::ENOENT),
      Err(e) => return Err(db_panic("rename", PgPretty(e))),
    };
    Ok(get_inode(&row))
  }

  pub fn del(&mut self, ino: u64) -> Result<(), c_int> {
    info!("del");
    do_sleep();
    let ns = self.namespace.to_string();
    let conn = self.get_conn()?;
    let query = format!("DELETE FROM {}.inodes WHERE id = $1", &ns);
    let ino: i64 = ino.try_into().unwrap();
    match conn.execute(&query, &[&ino]) {
      Ok(_) => Ok(()),
      Err(e) => Err(db_err("del", PgPretty(e))),
    }
  }

}
