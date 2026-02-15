# PRAGMA
SQLite calls its configurations [PRAGMA](https://sqlite.org/pragma.html).

All journal_modes are supported by SQLitesuperfs but only 2 are recommended. SQLite `make test` covers all modes.

## Journal_mode = DELETE
DELETE is the SQLite default and it works fine.

## Journal_mode = TRUNCATE
TRUNCATE is at this time the SQLitesuperfs recommendation. It only runs maybe 5% faster than DELETE but it results in less dead tuples for the PSQL server. So it is better for the health of the server.

## Journal_mode = WAL
Everyone wants to know about WAL. WAL is the crowd favorite and on a normal FS it is the best journal_mode. Many people think only WAL allows multi-reader but DELETE and TRUNCATE allow multi-reader also. The main advantage of WAL is that readers never block writes. With DELETE and TRUNCATE an INSERT *may* block waiting for a SELECT to complete. The SQLite locking protocol is actually very good and so there is only a small window in which for this to happen but it can happen.

SQLitesuperfs has optimized for DELETE and TRUNCATE without great difficulty but to do the same for WAL would be difficult. WAL may be recommended in the future but optimizations such as the read thread pool and VFS are better priorities.

## Synchronous = FULL
The only two settings for synchronous that should ever be considered are FULL and EXTRA. Synchronous has to do with when `fsync` is called and FULL is the SQLite default. EXTRA only does one additional thing which is to `fsync` the directory in which the db lives at the end of the commit protocol. Based on the use of PSQL SQLitesuperfs does not need EXTRA so use FULL.

## License
mike@rhodey.org

MIT
