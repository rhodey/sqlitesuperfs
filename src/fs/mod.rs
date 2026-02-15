use log::debug;
// use log::info;

use libc::c_int;
use std::path::Path;
use std::collections::HashMap;

use std::ffi::{OsStr, OsString};
use std::os::unix::ffi::OsStrExt;
use time::Timespec;
use base64::{engine::general_purpose, Engine as _};

use crate::db::PgDb;

use fuse::{
  Filesystem,
  Request,
  ReplyAttr,
  ReplyOpen,
  ReplyDirectory,
  ReplyEntry,
  ReplyCreate,
  ReplyWrite,
  ReplyData,
  ReplyStatfs,
  ReplyEmpty,
  FileType,
  FileAttr,
};

#[derive(Clone)]
#[derive(Debug)]
pub struct Inode {
  pub id: u64,
  pub parent: Option<u64>,
  pub typee: u32,
  pub nlink: u32,
  pub open: u32,
  pub name: OsString,
  pub create_ms: u64,
  pub modify_ms: u64,
  pub access_ms: u64,
  pub size: u64,
  pub mode: u32,
  pub uid: u32,
  pub gid: u32,
  pub flags: u32,
  pub path: Option<OsString>,
}

#[derive(Clone)]
#[derive(Debug)]
pub struct Block {
  pub ino: u64,
  pub num: u64,
  pub buf: Vec<u8>,
  pub ino_sz: u64,
}

fn round_up(n: u64, unit: u64) -> u64 {
  if unit == 0 { return n; }
  ((n + unit - 1) / unit) * unit
}

fn block_count(size: u64, block_sz: u64) -> u64 {
  if size == 0 {
    0
  } else {
    let alloc = round_up(size, block_sz);
    alloc / 512
  }
}

fn div_ceil(a: u64, b: u64) -> u64 {
  (a + b - 1) / b
}

fn to_ts(ms: u64) -> Timespec {
  let sec = (ms / 1000) as i64;
  let nsec = ((ms % 1000) * 1_000_000) as i32;
  Timespec { sec, nsec }
}

fn to_ms(ts: Timespec) -> u64 {
  let ms: u64 = (ts.sec * 1000 + (ts.nsec as i64 / 1_000_000)).try_into().unwrap();
  ms
}

// file names not always utf8
fn b64_encode(name: &OsStr) -> String {
  let bytes = name.as_bytes();
  general_purpose::STANDARD.encode(bytes)
}

fn zero_pad(blocks: Vec<Block>, block_sz: u64, ino_sz: u64, first: u64) -> Vec<Block> {
  if blocks.is_empty() { return Vec::new() }
  let ino = blocks[0].ino;
  let last = blocks.iter().map(|b| b.num).max().unwrap();
  let mut map: HashMap<u64, Vec<u8>> = HashMap::with_capacity(blocks.len());
  for block in blocks { map.insert(block.num, block.buf); }
  let mut out: Vec<Block> = Vec::new();
  let block_sz = block_sz as i64;
  for num in first..=last {
    let mut buf = map.remove(&num).unwrap_or_else(|| vec![]);
    let start = (num as i64) * block_sz;
    let end = (start + block_sz).min(ino_sz as i64);
    let len = (end - start).max(0) as usize;
    if buf.len() < len { buf.resize(len, 0); }
    out.push(Block { ino, num, buf, ino_sz: 0 });
  }
  out
}

impl Inode {
  fn attr(self, block_sz: u64) -> FileAttr {
    let kind = if self.typee == 1 {
      FileType::Directory
    } else if self.typee == 2 {
      FileType::RegularFile
    } else {
      FileType::Symlink
    };
    let mode_t = if self.typee == 1 {
      libc::S_IFDIR
    } else if self.typee == 2 {
      libc::S_IFREG
    } else {
      libc::S_IFLNK
    };
    let perm = (self.mode ^ mode_t) as u16;
    let attr = FileAttr {
      ino: self.id, kind,
      nlink: self.nlink,
      crtime: to_ts(self.create_ms),
      ctime: to_ts(self.modify_ms),
      mtime: to_ts(self.modify_ms),
      atime: to_ts(self.access_ms),
      size: self.size,
      blocks: block_count(self.size, block_sz),
      perm, uid: self.uid, gid: self.gid,
      flags: 0, rdev: 0,
    };
    return attr;
  }
}

type Cache = HashMap<u64, Inode>;
type Blocks = HashMap<u64, Block>;
type BlockCache = HashMap<u64, Blocks>;

#[allow(dead_code)]
pub struct Fs {
  uid: libc::uid_t,
  gid: libc::gid_t,
  block_sz: u64, buffers: u64, ttl: u64,
  fhc: u64,
  fh_map: Cache,
  fh_dmap: Cache,
  inodes: Cache,
  dblocks: BlockCache,
  jblocks: BlockCache,
  pgdb: PgDb,
}

impl Fs {
  pub fn new(uid: u32, gid: u32, block_sz: u64, buffers: u64, ttl: u64, pgdb: PgDb) -> Self {
    let fh_map: Cache = HashMap::new();
    let fh_dmap: Cache = HashMap::new();
    let inodes: Cache = HashMap::new();
    let dblocks: BlockCache = HashMap::new();
    let jblocks: BlockCache = HashMap::new();
    let buffers = 1024 * 1024 * buffers;
    let ttl = ttl * 1000;
    Fs {
      uid, gid,
      block_sz, buffers, ttl,
      fhc: 0, fh_map, fh_dmap, inodes,
      dblocks, jblocks,
      pgdb,
    }
  }

  fn get_ino(&mut self, ino: u64) -> Result<Option<Inode>, c_int> {
    let _inode: Option<Inode> = match self.inodes.get(&ino) {
      Some(inode) => return Ok(Some(inode.clone())),
      _ => None
    };
    let inode = match self.pgdb.getattr(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return Ok(None),
      Err(e) => return Err(e),
    };
    self.inodes.insert(ino, inode.clone());
    Ok(Some(inode))
  }

  fn trunc_buffers(&mut self, ino: u64, size: u64) -> bool {
    if self.buffers == 0 { return false }
    let block_map = self.dblocks.get_mut(&ino).or_else(|| self.jblocks.get_mut(&ino));
    if block_map.is_none() { return false }
    let block_map = block_map.unwrap();
    let end = div_ceil(size, self.block_sz);
    block_map.retain(|&key, _| key < end);
    let last = end.saturating_sub(1);
    let size = size.saturating_sub(last * self.block_sz);
    if let Some(last) = block_map.get_mut(&last) {
      last.buf.truncate(size as usize);
    }
    return true;
  }

  // todo: ?? can copy more efficiently
  fn read_buffers(&mut self, ino: u64, start: u64, end: u64, full: bool) -> Result<Vec<Block>, c_int> {
    if full {
      return Ok(Vec::new());
    } else if self.buffers == 0 {
      match self.pgdb.read(ino, start, end) {
        Ok(blocks) => return Ok(blocks),
        Err(errno) => return Err(errno),
      };
    }
    let mut blocks: Vec<Block> = Vec::new();
    let block_map = self.dblocks.get(&ino).or_else(|| self.jblocks.get(&ino));
    if let Some(block_map) = block_map {
      for num in start..end {
        if let Some(block) = block_map.get(&num) {
          blocks.push(block.clone());
        }
      }
    }
    if blocks.len() >= ((end - start) as usize) { return Ok(blocks) }
    let also = match self.pgdb.read(ino, start, end) {
      Ok(blocks) => blocks,
      Err(errno) => return Err(errno),
    };
    let also: Blocks = also.into_iter().map(|block| (block.num, block)).collect();
    for num in start..end {
      if let Some(block_map) = block_map {
        if block_map.contains_key(&num) { continue }
      }
      if let Some(also) = also.get(&num) {
        blocks.push(also.clone());
      }
    }
    Ok(blocks)
  }

  // todo: ?? can copy more efficiently
  fn sync_buffers(&mut self, ino: u64, db: bool, journal: bool) -> bool {
    if self.buffers == 0 { return false }
    let ino1 = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return false,
      Err(errno) => { panic!("(sync_buffers) (get_ino) {}", errno); },
    };
    let single = db == false && journal == false;
    let name;
    if let Some(n) = ino1.name.to_str() {
      if n.ends_with(".db") && (db || single) {
        name = n;
      } else if n.ends_with(".db-journal") && (journal || single) {
        name = n;
      } else {
        return false;
      }
    } else {
      return false;
    }

    let mut blocks1: Vec<Block> = Vec::new();
    let block_map = self.dblocks.get_mut(&ino).or_else(|| self.jblocks.get_mut(&ino));
    if block_map.is_none() { return false }
    let block_map = block_map.unwrap();
    for block in block_map.values() { blocks1.push(block.clone()); }
    if let Some(mut last) = blocks1.pop() {
      last.ino_sz = ino1.size;
      blocks1.push(last);
    }

    let keys = if name.ends_with(".db-journal") {
      block_map.clear();
      self.dblocks.keys()
    } else {
      block_map.retain(|&key, _| key == 0);
      self.jblocks.keys()
    };

    let test = if name.ends_with(".db-journal") {
      name.replace("-journal", "")
    } else {
      format!("{}-journal", name)
    };

    let mut i2: Option<u64> = None;
    let mut blocks2: Vec<Block> = Vec::new();
    if single == false {
      for ino in keys {
        let block_map = self.dblocks.get(&ino).or_else(|| self.jblocks.get(&ino)).unwrap();
        if block_map.len() == 0 { continue }
        if let Some(ino2) = self.inodes.get(ino) {
          if ino2.parent != ino1.parent { continue }
          if let Some(name2) = ino2.name.to_str() {
            if test != name2 { continue }
            i2 = Some(ino2.id);
            for block in block_map.values() { blocks2.push(block.clone()); }
            if let Some(mut last) = blocks2.pop() {
              last.ino_sz = ino2.size;
              blocks2.push(last);
            }
          }
        }
      }
    }

    if let Some(i2) = i2 {
      if name.ends_with(".db-journal") {
        self.dblocks.get_mut(&i2).unwrap().retain(|&key, _| key == 0);
      } else {
        self.jblocks.get_mut(&i2).unwrap().clear();
      }
    }

    let blocks = [blocks1, blocks2].concat();
    match self.pgdb.write(blocks, None, 0) {
      Err(errno) => { panic!("(sync_buffers) (write) {}", errno); },
      Ok(_) => return true,
    };
  }
}

impl Filesystem for Fs {

  fn init(&mut self, _req: &Request) -> Result<(), c_int> {
    debug!("init");
    Ok(())
  }

  // fuse-rs never calls
  fn destroy(&mut self, _req: &Request) {
    debug!("destroy");
  }

  fn access(&mut self, _req: &Request, ino: u64, _mask: u32, reply: ReplyEmpty) {
    let inode = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };
    let attr = inode.attr(self.block_sz);
    if attr.perm == 0 {
      return reply.error(libc::EACCES);
    }
    reply.ok();
  }

  fn getattr(&mut self, _req: &Request, ino: u64, reply: ReplyAttr) {
    let inode = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };
    let ttl = to_ts(self.ttl);
    reply.attr(&ttl, &inode.attr(self.block_sz));
  }

  fn lookup(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: ReplyEntry) {
    let name = b64_encode(name);
    let inode = match self.pgdb.lookup(parent, &name) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };
    let ttl = to_ts(self.ttl);
    let gen = 0;
    reply.entry(&ttl, &inode.attr(self.block_sz), gen);
  }

  fn opendir(&mut self, _req: &Request, ino: u64, flags: u32, reply: ReplyOpen) {
    let mut inode = match self.get_ino(ino) {
      Ok(Some(inode)) if inode.typee == 1 => inode,
      Ok(Some(_)) => return reply.error(libc::ENOTDIR),
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };
    inode.open += 1;
    self.inodes.insert(ino, inode.clone());
    self.fhc += 1;
    let fh = self.fhc;
    self.fh_dmap.insert(fh, inode);
    reply.opened(fh, flags);
  }

  fn readdir(&mut self, _req: &Request, ino: u64, fh: u64, offset: i64, mut reply: ReplyDirectory) {
    if offset < 0 { return reply.error(libc::EINVAL) }
    let _inode = match self.fh_dmap.get(&fh) {
      Some(inode) if inode.id == ino => inode,
      _ => return reply.error(libc::EBADF),
    };

    let mut dir = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };

    let off = if dir.parent.is_some() {
      (offset - 2).max(0)
    } else {
      (offset - 1).max(0)
    };

    let mut inodes = match self.pgdb.readdir(ino, off) {
      Ok(inodes) => inodes,
      Err(errno) => return reply.error(errno),
    };

    if offset == 0 {
      if dir.parent.is_some() {
        let mut parent = match self.get_ino(dir.parent.unwrap()) {
          Ok(Some(inode)) => inode,
          Ok(None) => return reply.error(libc::EIO),
          Err(errno) => return reply.error(errno),
        };
        parent.name = "..".into();
        inodes.insert(0, parent);
      }
      dir.name = ".".into();
      inodes.insert(0, dir);
    }

    let mut off = offset;
    for inode in inodes {
      off += 1;
      let fty = match inode.typee {
        1 => FileType::Directory,
        2 => FileType::RegularFile,
        _ => FileType::Symlink,
      };
      let full = reply.add(inode.id, off, fty, &Path::new(&inode.name));
      if full { break; }
    }
    reply.ok();
  }

  fn releasedir(&mut self, _req: &Request, ino: u64, fh: u64, _flags: u32, reply: ReplyEmpty) {
    let _inode = match self.fh_dmap.get(&fh) {
      Some(inode) if inode.id == ino => inode,
      _ => return reply.error(libc::EBADF),
    };
    let mut inode = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    inode.open = inode.open.saturating_sub(1);
    self.inodes.insert(ino, inode.clone());
    self.fh_dmap.remove(&fh);
    if inode.nlink > 0 || inode.open > 0 { return reply.ok(); }
    self.inodes.remove(&ino);
    match self.pgdb.del(ino) {
      Ok(_) => reply.ok(),
      Err(errno) => reply.error(errno),
    }
  }

  fn mknod(&mut self, _req: &Request, parent: u64, name: &OsStr, mode: u32, _rdev: u32, reply: ReplyEntry) {
    let name = b64_encode(name);
    let inode = match self.pgdb.mknod(parent, &name, mode, 2, None) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };
    self.inodes.insert(inode.id, inode.clone());
    let ttl = to_ts(self.ttl);
    let gen = 0;
    reply.entry(&ttl, &inode.attr(self.block_sz), gen);
  }

  fn open(&mut self, _req: &Request, ino: u64, flags: u32, reply: ReplyOpen) {
    let mut inode = match self.get_ino(ino) {
      Ok(Some(inode)) if inode.typee == 2 => inode,
      Ok(Some(_)) => return reply.error(libc::EINVAL),
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };
    let attr = inode.clone().attr(self.block_sz);
    if attr.perm == 0 {
      return reply.error(libc::EACCES);
    }
    inode.open += 1;
    self.inodes.insert(ino, inode.clone());
    self.fhc += 1;
    let fh = self.fhc;
    self.fh_map.insert(fh, inode.clone());
    if let Some(name) = inode.name.to_str() {
      if self.buffers > 0 && name.ends_with(".db") {
        self.dblocks.entry(ino).or_insert_with(|| HashMap::new());
        let blocks = self.dblocks.get_mut(&ino).unwrap();
        if blocks.contains_key(&0) { return reply.opened(fh, flags); }
        let first = match self.pgdb.read(ino, 0, 1) {
          Ok(blocks) => blocks,
          Err(errno) => return reply.error(errno),
        };
        let first = first.first().cloned().unwrap_or(Block { ino, num: 0, buf: vec![], ino_sz: 0 });
        blocks.insert(0, first);
      } else if self.buffers > 0 && name.ends_with(".db-journal") {
        self.jblocks.entry(ino).or_insert_with(|| HashMap::new());
      }
    }
    reply.opened(fh, flags);
  }

  fn create(&mut self, _req: &Request, parent: u64, name: &OsStr, mode: u32, flags: u32, reply: ReplyCreate) {
    let name = b64_encode(name);
    let mut inode = match self.pgdb.mknod(parent, &name, mode, 2, None) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };
    inode.open += 1;
    self.inodes.insert(inode.id, inode.clone());
    self.fhc += 1;
    let fh = self.fhc;
    self.fh_map.insert(fh, inode.clone());
    if let Some(name) = inode.name.to_str() {
      if self.buffers > 0 && name.ends_with(".db") {
        let first = Block { ino: inode.id, num: 0, buf: vec![], ino_sz: 0 };
        let mut blocks = HashMap::new();
        blocks.insert(0, first);
        self.dblocks.insert(inode.id, blocks);
      } else if self.buffers > 0 && name.ends_with(".db-journal") {
        self.jblocks.insert(inode.id, HashMap::new());
      }
    }
    let ttl = to_ts(self.ttl);
    let gen = 0;
    reply.created(&ttl, &inode.attr(self.block_sz), gen, fh, flags);
  }

  fn read(&mut self, _req: &Request, ino: u64, fh: u64, offset: i64, size: u32, reply: ReplyData) {
    if offset < 0 { return reply.error(libc::EINVAL) }
    let _inode = match self.fh_map.get(&fh) {
      Some(inode) if inode.id == ino => inode,
      _ => return reply.error(libc::EBADF),
    };
    let inode = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      _ => return reply.error(libc::EIO),
    };

    let ino_sz = inode.size;
    let offset = offset.max(0) as u64;

    if offset >= ino_sz || size == 0 {
      reply.data(&[]);
      return;
    }

    let sz = size as u64;
    let block_sz = self.block_sz;
    let start = offset / block_sz;
    let end = div_ceil(offset + sz, block_sz);

    // read from buffers and/or db
    let mut blocks = match self.read_buffers(ino, start, end, false) {
      Ok(blocks) => blocks,
      Err(errno) => return reply.error(errno),
    };

    // read
    blocks.sort_by_key(|block| block.num);
    let blocks = zero_pad(blocks, self.block_sz, ino_sz, start);
    let buf: Vec<u8> = blocks
      .into_iter()
      .flat_map(|b| b.buf)
      .collect();

    // relative
    let st = (start * block_sz) as i64;
    let off = ((offset as i64) - st).max(0);
    let i_sz = ((ino_sz as i64) - st).max(0);

    // limit to i_sz
    let e = (i_sz as usize).min(buf.len());
    let buf = &buf[0..e];

    // pad zeros
    let end = (end * block_sz) as i64;
    let e = (end - st).max(0).min(i_sz);
    let z = (e - buf.len() as i64).max(0) as usize;
    let z: Vec<u8> = vec![0; z];
    let buf = [buf, &z].concat();

    // dont give more than ask
    let e = e.min(off + (sz as i64)) as usize;
    if e > buf.len() {
      panic!("(read) {} start {} end {} ino_sz {} offset {} off {} sz {} i_sz {} len {} e {}", ino, st, end, ino_sz, offset, off, sz, i_sz, buf.len(), e);
    }

    let off = (off as usize).min(e);
    let buf = &buf[off..e];
    reply.data(buf);
  }

  fn write(&mut self, _req: &Request, ino: u64, fh: u64, offset: i64, data: &[u8], _flags: u32, reply: ReplyWrite) {
    if offset < 0 { return reply.error(libc::EINVAL) }
    let _inode = match self.fh_map.get(&fh) {
      Some(inode) if inode.id == ino => inode,
      _ => return reply.error(libc::EBADF),
    };
    let mut orig = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      _ => return reply.error(libc::EIO),
    };
    if data.is_empty() { return reply.written(0); }
    let offset = offset.max(0) as u64;
    let sz = data.len() as u64;
    let block_sz = self.block_sz;
    let start = offset / block_sz;
    let end = div_ceil(offset + sz, block_sz);
    let ino_sz = orig.size;
    let next_sz = orig.size.max(offset + sz);

    // if writing full blocks then there is no need to read
    let full_blocks = offset == (start * block_sz) && (offset + sz) == (end * block_sz);

    // read from buffers and/or db
    let mut blocks = match self.read_buffers(ino, start, end, full_blocks) {
      Ok(blocks) => blocks,
      Err(errno) => return reply.error(errno),
    };

    // write
    blocks.sort_by_key(|block| block.num);
    let blocks = zero_pad(blocks, self.block_sz, ino_sz, start);
    let buf: Vec<u8> = blocks
      .into_iter()
      .flat_map(|b| b.buf)
      .collect();

    // relative
    let st = (start * block_sz) as i64;
    let off = ((offset as i64) - st).max(0) as usize;
    let i_sz = ((ino_sz as i64) - st).max(0) as usize;

    // limit to i_sz
    let e = i_sz.min(buf.len());
    let buf = &buf[0..e];

    // pad zeros
    let ee = off + (sz as usize);
    let z = ((ee as i64) - (buf.len() as i64)).max(0) as usize;
    let z: Vec<u8> = vec![0; z];
    let buf = [buf, &z].concat();

    // combine
    let ready: Vec<u8>;
    let left = &buf[0..off];
    if buf.len() > ee {
      let right = &buf[ee..];
      ready = [left, data, right].concat();
    } else {
      ready = [left, data].concat();
    }

    // to blocks
    let mut num = start;
    let mut off: usize = 0;
    let mut blocks: Vec<Block> = Vec::new();
    while off < ready.len() {
      let end = off + (block_sz as usize);
      let end = end.min(ready.len());
      let block = &ready[off..end];
      let block = block.to_vec();
      off += block.len();
      blocks.push(Block { ino, num: num, buf: block, ino_sz: 0 });
      num += 1;
    }

    // to txn buffer
    if self.buffers > 0 {
      let s1: usize = self.dblocks.values().map(|map| map.len()).sum();
      let s2: usize = self.jblocks.values().map(|map| map.len()).sum();
      let mut size = ((s1 + s2) as u64) * self.block_sz;
      if let Some(block_map) = self.dblocks.get_mut(&ino).or_else(|| self.jblocks.get_mut(&ino)) {
        for block in blocks {
          if block_map.insert(block.num, block).is_none() {
            size += self.block_sz;
          }
        }
        orig.size = next_sz;
        self.inodes.insert(orig.id, orig);
        if size <= self.buffers { return reply.written(sz as u32); }
        if self.sync_buffers(ino, true, true) {
          return reply.written(sz as u32);
        } else {
          panic!("(write) (sync_buffers) false");
        }
      }
    }

    let mut last = blocks.pop().unwrap();
    last.ino_sz = next_sz;
    blocks.push(last);

    // to db
    match self.pgdb.write(blocks, None, 0) {
      Err(errno) => return reply.error(errno),
      Ok(_) => {},
    };

    orig.size = next_sz;
    self.inodes.insert(orig.id, orig);
    reply.written(sz as u32);
  }

  fn setattr(
    &mut self, _req: &Request, ino: u64,
    mode: Option<u32>, uid: Option<u32>, gid: Option<u32>, size: Option<u64>, atime: Option<Timespec>, mtime: Option<Timespec>,
    _fh: Option<u64>, crtime: Option<Timespec>, _chgtime: Option<Timespec>, _bkuptime: Option<Timespec>, flags: Option<u32>,
    reply: ReplyAttr)
  {
    let mut orig = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };

    let mut inode = orig.clone();

    if mode.is_some() {
      inode.mode = mode.unwrap();
    }
    if uid.is_some() {
      inode.uid = uid.unwrap();
    }
    if gid.is_some() {
      inode.gid = gid.unwrap();
    }
    if size.is_some() {
      inode.size = size.unwrap();
    }
    if atime.is_some() {
      inode.access_ms = to_ms(atime.unwrap());
    }
    if mtime.is_some() {
      inode.modify_ms = to_ms(mtime.unwrap());
    }
    if crtime.is_some() {
      inode.create_ms = to_ms(crtime.unwrap());
    }
    if flags.is_some() {
      inode.flags = flags.unwrap();
    }

    // is buffered
    if size.is_some() && self.trunc_buffers(ino, inode.size) && inode.size > 0 {
      orig.size = inode.size;
      self.inodes.insert(orig.id, orig.clone());
      let ttl = to_ts(self.ttl);
      return reply.attr(&ttl, &orig.attr(self.block_sz));
    }

    let block_sz = self.block_sz;
    let end_block = div_ceil(inode.size, block_sz);

    if size.is_none() || size == Some(orig.size) || (inode.size % block_sz) == 0 || inode.size > orig.size {
      // is fast (normal)
      inode = match self.pgdb.setattr(inode, end_block) {
        Ok(inode) => inode,
        Err(errno) => return reply.error(errno),
      };
    } else {
      // is slow (rare)
      let last_block = end_block.saturating_sub(1);
      let last_len = inode.size.saturating_sub(last_block * block_sz) as u32;
      let blocks = match self.pgdb.read(ino, last_block, end_block) {
        Ok(blocks) => blocks,
        Err(errno) => return reply.error(errno),
      };
      if let Some(first) = blocks.first() {
        let mut first = first.clone();
        first.buf.truncate(last_len as usize);
        inode = match self.pgdb.write(blocks, Some(inode), end_block) {
          Ok(inode) => inode.unwrap(),
          Err(errno) => return reply.error(errno),
        };
      } else {
        inode = match self.pgdb.setattr(inode, end_block) {
          Ok(inode) => inode,
          Err(errno) => return reply.error(errno),
        };
      }
    }

    inode.open = orig.open;
    self.inodes.insert(inode.id, inode.clone());
    let ttl = to_ts(self.ttl);
    reply.attr(&ttl, &inode.attr(self.block_sz));
  }

  fn flush(&mut self, _req: &Request, ino: u64, fh: u64, _lock_owner: u64, reply: ReplyEmpty) {
    let file = match self.fh_map.get(&fh) {
      Some(inode) if inode.id == ino => true,
      _ => false,
    };
    let dir = match self.fh_dmap.get(&fh) {
      Some(inode) if inode.id == ino => true,
      _ => false,
    };
    if !file && !dir {
      return reply.error(libc::EBADF);
    }
    reply.ok()
  }

  fn fsync(&mut self, _req: &Request, ino: u64, fh: u64, _datasync: bool, reply: ReplyEmpty) {
    let _inode = match self.fh_map.get(&fh) {
      Some(inode) if inode.id == ino => ino,
      _ => return reply.error(libc::EBADF),
    };
    if let Some(_block_map) = self.dblocks.get(&ino) {
      if self.sync_buffers(ino, true, false) {
        return reply.ok();
      } else {
        panic!("(fsync) (sync_buffers) false");
      }
    } else {
      return reply.ok();
    }
  }

  fn fsyncdir(&mut self, _req: &Request, ino: u64, fh: u64, _datasync: bool, reply: ReplyEmpty) {
    let _inode = match self.fh_dmap.get(&fh) {
      Some(inode) if inode.id == ino => return reply.ok(),
      _ => return reply.error(libc::EBADF),
    };
  }

  fn release(&mut self, _req: &Request, ino: u64, fh: u64, _flags: u32, _lock_owner: u64, _flush: bool, reply: ReplyEmpty) {
    let _inode = match self.fh_map.get(&fh) {
      Some(inode) if inode.id == ino => inode,
      _ => return reply.error(libc::EBADF),
    };
    let mut inode = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    inode.open = inode.open.saturating_sub(1);
    self.inodes.insert(ino, inode.clone());
    self.fh_map.remove(&fh);
    if inode.open == 0 { self.sync_buffers(ino, false, false); }
    if inode.nlink > 0 || inode.open > 0 { return reply.ok(); }
    self.inodes.remove(&ino);
    self.dblocks.remove(&ino);
    self.jblocks.remove(&ino);
    match self.pgdb.del(ino) {
      Ok(_) => reply.ok(),
      Err(errno) => reply.error(errno),
    }
  }

  fn unlink(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: ReplyEmpty) {
    let name = b64_encode(name);
    let mut inode = match self.pgdb.unlink(parent, &name) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };
    let orig = match self.get_ino(inode.id) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    inode.open = orig.open;
    inode.size = orig.size;
    self.inodes.insert(inode.id, inode.clone());
    if inode.nlink > 0 || inode.open > 0 { return reply.ok(); }
    self.inodes.remove(&inode.id);
    self.dblocks.remove(&inode.id);
    self.jblocks.remove(&inode.id);
    match self.pgdb.del(inode.id) {
      Ok(_) => reply.ok(),
      Err(errno) => reply.error(errno),
    }
  }

  fn mkdir(&mut self, _req: &Request, parent: u64, name: &OsStr, mode: u32, reply: ReplyEntry) {
    let name = b64_encode(name);
    let inode = match self.pgdb.mknod(parent, &name, mode, 1, None) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };
    let mut parent = match self.get_ino(parent) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    parent.nlink += 1;
    self.inodes.insert(inode.id, inode.clone());
    self.inodes.insert(parent.id, parent);
    let ttl = to_ts(self.ttl);
    let gen = 0;
    reply.entry(&ttl, &inode.attr(self.block_sz), gen);
  }

  fn rmdir(&mut self, _req: &Request, parent: u64, name: &OsStr, reply: ReplyEmpty) {
    let name = b64_encode(name);
    let mut inode = match self.pgdb.rmdir(parent, &name) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };
    let orig = match self.get_ino(inode.id) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    let mut parent = match self.get_ino(parent) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    inode.open = orig.open;
    parent.nlink = parent.nlink.saturating_sub(1);
    self.inodes.insert(inode.id, inode.clone());
    self.inodes.insert(parent.id, parent);
    if inode.nlink > 0 || inode.open > 0 { return reply.ok(); }
    self.inodes.remove(&inode.id);
    match self.pgdb.del(inode.id) {
      Ok(_) => reply.ok(),
      Err(errno) => reply.error(errno),
    }
  }

  fn link(&mut self, _req: &Request, ino: u64, new_parent: u64, new_name: &OsStr, reply: ReplyEntry) {
    let orig = match self.get_ino(ino) {
      Ok(Some(inode)) if inode.typee == 2 => inode,
      Ok(Some(inode)) if inode.typee == 1 => return reply.error(libc::EISDIR),
      Ok(Some(_)) => return reply.error(libc::EINVAL),
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };
    let new_name = b64_encode(new_name);
    let mut inode = match self.pgdb.link(ino, new_parent, &new_name) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };
    inode.open = orig.open;
    self.inodes.insert(ino, inode.clone());
    let ttl = to_ts(self.ttl);
    let gen = 0;
    reply.entry(&ttl, &inode.attr(self.block_sz), gen);
  }

  fn symlink(&mut self, _req: &Request, parent: u64, name: &OsStr, path: &Path, reply: ReplyEntry) {
    let name = b64_encode(name);
    let mode: u32 = 0o777;
    let path = b64_encode(path.as_os_str());
    let path = Some(path.as_str());
    let inode = match self.pgdb.mknod(parent, &name, mode, 3, path) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };
    self.inodes.insert(inode.id, inode.clone());
    let ttl = to_ts(self.ttl);
    let gen = 0;
    reply.entry(&ttl, &inode.attr(self.block_sz), gen);
  }

  fn readlink(&mut self, _req: &Request, ino: u64, reply: ReplyData) {
    let inode = match self.get_ino(ino) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::ENOENT),
      Err(errno) => return reply.error(errno),
    };
    if let Some(path) = inode.path {
      let bytes = path.as_bytes();
      return reply.data(&bytes);
    }
    reply.error(libc::EINVAL);
  }

  fn rename(&mut self, _req: &Request, parent: u64, name: &OsStr, new_parent: u64, new_name: &OsStr, reply: ReplyEmpty) {
    let name = b64_encode(name);
    let new_name = b64_encode(new_name);

    let mut inode = match self.pgdb.rename(parent, &name, new_parent, &new_name) {
      Ok(inode) => inode,
      Err(errno) => return reply.error(errno),
    };

    let orig = match self.get_ino(inode.id) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    let mut p1 = match self.get_ino(parent) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };
    let mut p2 = match self.get_ino(new_parent) {
      Ok(Some(inode)) => inode,
      Ok(None) => return reply.error(libc::EIO),
      Err(errno) => return reply.error(errno),
    };

    inode.open = orig.open;
    inode.size = orig.size;
    if inode.typee == 1 {
      p1.nlink = p1.nlink.saturating_sub(1);
      p2.nlink += 1;
    }

    self.inodes.insert(inode.id, inode);
    self.inodes.insert(p1.id, p1);
    self.inodes.insert(p2.id, p2);
    reply.ok();
  }

  // todo: real
  fn statfs(&mut self, _req: &Request, _ino: u64, reply: ReplyStatfs) {
    let blocks = 0;
    let bfree = 1_000_000;
    let bavail = 1_000_000;
    let files = 0;
    let ffree = 1_000_000;
    let bsize = self.block_sz as u32;
    let namelen = 512;
    let frsize = bsize;
    reply.statfs(blocks, bfree, bavail, files, ffree, bsize, namelen, frsize);
  }

}

pub fn mount(fs: Fs, mount_dir: &str, kernel_opts: &str) {
  let mount_path = Path::new(mount_dir);
  let opts = &[OsStr::new("-o"), OsStr::new(&kernel_opts)];
  println!("mounted");
  let result = fuse::mount(fs, &mount_path, opts);
  match result {
    Ok(_r) => {
      println!("unmount ok");
    }
    Err(err) => {
      panic!("(unmount) error {}", err);
    }
  }
}
