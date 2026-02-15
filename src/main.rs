#[macro_use]
extern crate log;
extern crate clap;

pub mod fs;
pub mod db;

use clap::Arg;
use std::path::Path;
use libsodium_rs::{self, ensure_init};

fn main() {
  env_logger::init();
  ensure_init().expect("libsodium init failed");

  let uid = unsafe { libc::getuid() as u32 };
  let gid = unsafe { libc::getgid() as u32 };

  let matches = clap::Command::new("sqlitesuperfs")
        .arg(Arg::new("namespace").required(true))
        .arg(Arg::new("mount_dir").required(true))
        .arg(Arg::new("sql_schema").short('s'))
        .arg(Arg::new("block_sz").long("block_sz").default_value("4096").value_parser(clap::value_parser!(u64)))
        .arg(Arg::new("buffers").long("buffers").default_value("20").value_parser(clap::value_parser!(u64)))
        .arg(Arg::new("ttl").long("ttl").default_value("600").value_parser(clap::value_parser!(u64)))
        .arg(Arg::new("uid").short('u').value_parser(clap::value_parser!(u32)))
        .arg(Arg::new("gid").short('g').value_parser(clap::value_parser!(u32)))
        .arg(Arg::new("kernel_opts").short('o'))
        .get_matches();

  let namespace = matches.get_one::<String>("namespace").unwrap();
  debug!("{} namespace", namespace);

  let mount_dir = matches.get_one::<String>("mount_dir").unwrap();
  debug!("{} mount_dir", mount_dir);

  let psql_url = std::env::var("psql_url").expect("need env psql_url");
  let enc_pass = std::env::var("encryption_pass").expect("need env encryption_pass");

  let sql_schemaa = matches.get_one::<String>("sql_schema");
  let sql_schema = if sql_schemaa.is_some() {
    let sql_schemaa = sql_schemaa.unwrap();
    debug!("{} sql_schema", sql_schemaa);
    let file = std::fs::read_to_string(sql_schemaa).expect("error sql_schema");
    Some(file)
  } else {
    None
  };

  let block_sz: u64 = *matches.get_one::<u64>("block_sz").unwrap();
  debug!("{} block_sz", block_sz);

  let buffers: u64 = *matches.get_one::<u64>("buffers").unwrap();
  debug!("{} buffers", buffers);

  let ttl: u64 = *matches.get_one::<u64>("ttl").unwrap();
  debug!("{} ttl", ttl);

  let uid: u32 = *matches.get_one::<u32>("uid").unwrap_or_else(|| { &uid });
  let gid: u32 = *matches.get_one::<u32>("gid").unwrap_or_else(|| { &gid });
  debug!("{} {} uid gid", uid, gid);

  let u = format!("uid={}", uid);
  let g = format!("gid={}", gid);
  let defaults = format!("{},{},allow_other,default_permissions", u, g);
  let kernel_opts = matches.get_one::<String>("kernel_opts").unwrap_or_else(|| { &defaults });
  let kernel_opts = format!("{},{},{}", u, g, kernel_opts);
  debug!("{} kernel_opts", kernel_opts);

  if Path::new(&mount_dir).exists() {
    let umount_cmd = format!("fusermount -u {}", mount_dir);
    ctrlc::set_handler(move || {
      println!("signal = unmount");
      std::process::Command::new("sh")
        .arg("-c")
        .arg(&umount_cmd)
        .output()
        .expect("error fusermount");
      std::process::exit(0);
    })
    .expect("error signals");

    let mut pgdb = db::PgDb::new(uid, gid, &psql_url, namespace, &enc_pass);
    let block_szz = pgdb.init(sql_schema, block_sz).expect("error init_schema");

    if block_sz != block_szz {
      eprintln!("block size {} does not match db block size {}", block_sz, block_szz);
      std::process::exit(1);
    }

    let fs = fs::Fs::new(uid, gid, block_sz, buffers, ttl, pgdb);
    fs::mount(fs, mount_dir, &kernel_opts);
  } else {
    error!("mount_dir {} does not exist", mount_dir);
    std::process::exit(1);
  }
}
