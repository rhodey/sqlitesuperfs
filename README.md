# SQLitesuperfs
FUSE fs with PostgreSQL backend, block-level encryption, and optimizations for SQLite multi-tenancy.

## Why
[Lock.host](https://github.com/rhodey/lock.host) allows apps to attest to their code and to encrypt comms with clients. Lock.host also allows apps to create persistent keys. SQLitesuperfs was created to allow apps to keep persistent state (SQLite) and to keep that state private. All existing open-source encrypted filesystems use AES which fundamentally is vulnerable to timing attacks. Timing attacks mean "do not run this in the cloud". [Libsodium](https://doc.libsodium.org/) is used and is not vulnerable to timing attacks.

## Architecture / Scale
All PostgreSQL tables and functions are namespaced into PSQL schemas. This allows for multiple `sqlitesuperfs` instances to share 1 PSQL server. Schemas are the PSQL native multi-tenant pattern. Amazon Aurora databases can grow to 256TiB so this is really cool, but you probably want to consider sharding users to 1 of N servers before you approach 256TiB. Also consider [neon.com](https://neon.com/).

## Build
```
git clone https://github.com/rhodey/sqlitesuperfs
cd sqlitesuperfs
apt install fuse libfuse-dev
cargo build --release
```

## Run
```
docker compose up -d psql
mkdir -p /tmp/super1
./target/release/sqlitesuperfs --help
export psql_url=postgresql://psql:psql@localhost:5432/psql
export encryption_pass=supersuper
./target/release/sqlitesuperfs super1 /tmp/super1
echo hi >> /tmp/super1/hi
echo hi >> /tmp/super1/hi
echo hi >> /tmp/super1/hi
cat /tmp/super1/hi
```

## Multi-Process Same-Namespace
All write operations are atomic (one PSQL txn) so this is good. However the linux kernel can be configured to cache the results of FUSE operations and you want this for performance. Additionally the FS needs to keep counters for open file descriptors and you want this in memory for performance. Additionally additionally SQLite uses file locks and SQLitesuperfs tells the kernel "you do all file locking for me" and this is for performance. So effectively the pattern is 1 `sqlitesuperfs` mount per namespace.

## Threading
SQLitesuperfs is at this time single threaded. SQLite is fundamentally 1-writer-multi-reader and so it does make sense for SQLitesuperfs to add a read thread pool. Contributions welcome! Keep in mind multiple apps are multiple namespaces (schemas) and do not have lock contention with eachother though they all share PSQL I/O.

## Quick Test
Nodejs is in this repo to do tests:
```
docker compose up -d psql
mkdir -p ./testdir
export psql_url=postgresql://psql:psql@localhost:5432/psql
export encryption_pass=supersuper
RUST_LOG=debug cargo run -- test1 $(pwd)/testdir
npm install
npm run test
```

## Serious Test
SQLitesuperfs passes `make test` in the official SQLite source tree. So you can:
+ Download and compile SQLite sources
+ Mount /tmp/super1 with SQLitesuperfs
+ Copy the source tree to /tmp/super1
+ Run `make test` from the mount

## Performance
When the PSQL server is localhost SQLite is 15% faster than native FS thanks to SQLitesuperfs buffering. When the PSQL server has 0.2ms simulated RTT latency SQLite is 2x to 3x slower than native FS. SQLitesuperfs is primarily about *private hosted SQLite impossible => possible*. SQLitesuperfs even at 100x would be an achievement compared to Fully Homomorphic Encryption being 100,000x to 1,000,000x.

The read thread pool described earlier will help and additionally a custom [VFS](https://sqlite.org/vfs.html) can be added to improve writes but TBH I am very happy already to build apps on this so I dont say I will be back here to add either *super* soon.

## Security
+ File names and file sizes are not encrypted (for sqlite who cares)
+ SQLitesuperfs can be tricked into serving an older version of a block (rollback)
+ Something with Merkle Trees and [TEEs](https://en.wikipedia.org/wiki/Trusted_execution_environment) can stop rollback (future)
+ (Every encrypted filesystem is vulnerable to rollback)

## Also
Multi-Host Same-Namespace is not really on the roadmap but it is possible. Most of what you want from Multi-Host is: 1. durability 2. horizontal scaling. 1 is covered by PSQL and 2, well, just use a bigger host (and keep code simple). Multi-Host Same-Namespace would be something like LiteFS with SQLite WAL mode where you have 1 primary and N (asynchronous) replicas. LiteFS is cool but it should be noted that LiteFS durability is weaker, COMMIT always returns before replicas replicate.

## Also
SQLitesuperfs optimizations can be applied to data structures like [tinyraftplus](https://github.com/rhodey/tinyraftplus) if they have a lockfile protocol similar to SQLite:
```
sqlitesuperfs super1 /tmp/super1
sqlitesuperfs super1 /tmp/super1 --pattern db-journal,db
sqlitesuperfs super1 /tmp/super1 --pattern db-journal,db --pattern lock,off,log
```

The first and second commands are equivalent. And the third command is what would be used to optimize SQLite and tinyraftplus at the same time. One more doc [PRAGMA.md](PRAGMA.md) about SQLite `journal_mode` and `synchronous`.

## License
mike@rhodey.org

MIT
