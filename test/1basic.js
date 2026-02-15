const fs = require('fs')
const test = require('tape')

const DIR = `./testdir`
const UID = process.getuid()
const GID = process.getgid()

const perms = (mode) => (mode & 0o777).toString(8)
const rmr = (path) => fs.rmSync(path, { recursive: true })
const sleep = (ms) => new Promise((res, rej) => setTimeout(res, ms))

const GH = !!process.env.GITHUB_RUN_ID

const empty = (dir) => {
  const arr = fs.readdirSync(dir, { withFileTypes: true })
  arr.forEach((entry) => {
    const path = `${entry.path}/${entry.name}`
    rmr(path)
  })
}

// todo: mode not consistent on github runner

test('readdir empty', (t) => {
  empty(DIR)
  const arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.equal(arr.length, 0, 'empty')
  t.end()
})

test('read no file', (t) => {
  empty(DIR)

  const name = `${DIR}/file1`
  const flags = ['r', 'rs', 'r+', 'rs+']

  for (const f of flags) {
    console.log('flag =>', f)
    empty(DIR)

    try {
      fs.readFileSync(name, { flag: f })
      t.fail(`${f} no read error`)
    } catch (err) {
      t.pass(`${f} read error`)
      t.equal(err.code, 'ENOENT', `${f} read error ENOENT`)
    }

    try {
      fs.accessSync(name)
      t.fail(`${f} no access error`)
    } catch (err) {
      t.pass(`${f} access error`)
      t.equal(err.code, 'ENOENT', `${f} access error ENOENT`)
    }

    try {
      fs.statSync(name)
      t.fail(`${f} no stat error`)
    } catch (err) {
      t.pass(`${f} stat error`)
      t.equal(err.code, 'ENOENT', `${f} stat error ENOENT`)
    }

    try {
      fs.lstatSync(name)
      t.fail(`${f} no lstat error`)
    } catch (err) {
      t.pass(`${f} lstat error`)
      t.equal(err.code, 'ENOENT', `${f} lstat error ENOENT`)
    }

    try {
      fs.rmSync(name)
      t.fail(`${f} no rm error`)
    } catch (err) {
      t.pass(`${f} rm error`)
      t.equal(err.code, 'ENOENT', `${f} rm error ENOENT`)
    }

    try {
      fs.unlinkSync(name)
      t.fail(`${f} no unlink error`)
    } catch (err) {
      t.pass(`${f} unlink error`)
      t.equal(err.code, 'ENOENT', `${f} unlink error ENOENT`)
    }
  }

  t.end()
})

test('write no file', (t) => {
  empty(DIR)

  let flags = ['w', 'wx', 'wx+', 'a', 'a+', 'ax', 'ax+', 'as', 'as+']
  if (GH) { flags = flags.filter((f) => !f.includes('x')) }

  const n = `file1`
  const name = `${DIR}/${n}`
  const mode = [0o664, '664']

  const step = (f, rm=1) => {
    console.log('flag =>', f)
    empty(DIR)

    fs.writeFileSync(name, 'hihihi', { flag: f, mode: mode[0] })
    t.pass(`${f} write ok`)

    fs.accessSync(name)
    t.pass(`${f} access ok`)

    let stat = fs.statSync(name)
    t.pass(`${f} stat ok`)
    let ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode[1], `${f} mode`)

    stat = fs.lstatSync(name)
    t.pass(`${f} lstat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode[1], `${f} mode`)

    let arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} readdir ok`)
    t.equal(arr.length, 1, '1 entry')
    t.ok(arr[0].isFile(), '1 file')
    t.equal(arr[0].name, n, '1 name')

    if (rm) {
      fs.rmSync(name)
      t.pass(`${f} rm ok`)
    } else {
      fs.unlinkSync(name)
      t.pass(`${f} unlink ok`)
    }

    arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} readdir ok`)
    t.equal(arr.length, 0, '0 entry')

    try {
      fs.accessSync(name)
      t.fail(`${f} no access error`)
    } catch (err) {
      t.pass(`${f} access error`)
      t.equal(err.code, 'ENOENT', `${f} access error ENOENT`)
    }

    try {
      fs.statSync(name)
      t.fail(`${f} no stat error`)
    } catch (err) {
      t.pass(`${f} stat error`)
      t.equal(err.code, 'ENOENT', `${f} stat error ENOENT`)
    }

    try {
      fs.lstatSync(name)
      t.fail(`${f} no lstat error`)
    } catch (err) {
      t.pass(`${f} lstat error`)
      t.equal(err.code, 'ENOENT', `${f} lstat error ENOENT`)
    }

    try {
      fs.rmSync(name)
      t.fail(`${f} no rm error`)
    } catch (err) {
      t.pass(`${f} rm error`)
      t.equal(err.code, 'ENOENT', `${f} rm error ENOENT`)
    }

    try {
      fs.unlinkSync(name)
      t.fail(`${f} no unlink error`)
    } catch (err) {
      t.pass(`${f} unlink error`)
      t.equal(err.code, 'ENOENT', `${f} unlink error ENOENT`)
    }

    fs.writeFileSync(name, 'hihihi', { flag: f, mode: mode[0] })
    t.pass(`${f} again write ok`)

    fs.accessSync(name)
    t.pass(`${f} again access ok`)

    stat = fs.statSync(name)
    t.pass(`${f} again stat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode[1], `${f} mode`)

    arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} again readdir ok`)
    t.equal(arr.length, 1, '1 entry')
    t.ok(arr[0].isFile(), '1 file')
    t.equal(arr[0].name, n, '1 name')
  }

  for (const f of flags) {
    step(f, 0)
    step(f, 1)
  }

  t.end()
})

test('open read no file', (t) => {
  empty(DIR)

  const name = `${DIR}/file1`
  const flags = ['r', 'rs', 'r+', 'rs+']

  for (const f of flags) {
    console.log('flag =>', f)
    empty(DIR)

    try {
      fs.openSync(name, f)
      t.fail(`${f} no read error`)
    } catch (err) {
      t.pass(`${f} read error`)
      t.equal(err.code, 'ENOENT', `${f} read error ENOENT`)
    }

    try {
      fs.accessSync(name)
      t.fail(`${f} no access error`)
    } catch (err) {
      t.pass(`${f} access error`)
      t.equal(err.code, 'ENOENT', `${f} access error ENOENT`)
    }

    try {
      fs.statSync(name)
      t.fail(`${f} no stat error`)
    } catch (err) {
      t.pass(`${f} stat error`)
      t.equal(err.code, 'ENOENT', `${f} stat error ENOENT`)
    }

    try {
      fs.lstatSync(name)
      t.fail(`${f} no lstat error`)
    } catch (err) {
      t.pass(`${f} lstat error`)
      t.equal(err.code, 'ENOENT', `${f} lstat error ENOENT`)
    }

    try {
      fs.rmSync(name)
      t.fail(`${f} no rm error`)
    } catch (err) {
      t.pass(`${f} rm error`)
      t.equal(err.code, 'ENOENT', `${f} rm error ENOENT`)
    }

    try {
      fs.unlinkSync(name)
      t.fail(`${f} no unlink error`)
    } catch (err) {
      t.pass(`${f} unlink error`)
      t.equal(err.code, 'ENOENT', `${f} unlink error ENOENT`)
    }
  }

  t.end()
})

test('open write no file', (t) => {
  empty(DIR)

  let flags = ['w', 'wx', 'wx+', 'a', 'a+', 'ax', 'ax+', 'as', 'as+']
  if (GH) { flags = flags.filter((f) => !f.includes('x')) }

  const n = `file1`
  const name = `${DIR}/${n}`
  const mode = [0o664, '664']

  const step = (f, rm=1) => {
    console.log('flag =>', f)
    empty(DIR)

    let fd = fs.openSync(name, f)
    t.pass(`${f} open ok`)
    t.equal(typeof fd, 'number', `${f} fd num`)
    t.ok(fd >= 0, `${f} fd ${fd} >= 0`)

    fs.accessSync(name)
    t.pass(`${f} access ok`)

    let stat = fs.fstatSync(fd)
    t.pass(`${f} stat ok`)
    let ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode[1], `${f} mode`)

    fs.closeSync(fd)
    t.pass(`${f} close ok`)

    try {
      fs.closeSync(fd)
      t.fail(`${f} no close error`)
    } catch (err) {
      t.pass(`${f} close error`)
      t.equal(err.code, 'EBADF', `${f} close error EBADF`)
    }

    fs.accessSync(name)
    t.pass(`${f} access ok`)

    stat = fs.statSync(name)
    t.pass(`${f} stat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode[1], `${f} mode`)

    stat = fs.lstatSync(name)
    t.pass(`${f} lstat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode[1], `${f} mode`)

    let arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} readdir ok`)
    t.equal(arr.length, 1, '1 entry')
    t.ok(arr[0].isFile(), '1 file')
    t.equal(arr[0].name, n, '1 name')

    if (rm) {
      fs.rmSync(name)
      t.pass(`${f} rm ok`)
    } else {
      fs.unlinkSync(name)
      t.pass(`${f} unlink ok`)
    }

    arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} readdir ok`)
    t.equal(arr.length, 0, '0 entry')

    try {
      fs.accessSync(name)
      t.fail(`${f} no access error`)
    } catch (err) {
      t.pass(`${f} access error`)
      t.equal(err.code, 'ENOENT', `${f} access error ENOENT`)
    }

    try {
      fs.rmSync(name)
      t.fail(`${f} no rm error`)
    } catch (err) {
      t.pass(`${f} rm error`)
      t.equal(err.code, 'ENOENT', `${f} rm error ENOENT`)
    }

    try {
      fs.unlinkSync(name)
      t.fail(`${f} no unlink error`)
    } catch (err) {
      t.pass(`${f} unlink error`)
      t.equal(err.code, 'ENOENT', `${f} unlink error ENOENT`)
    }

    fd = fs.openSync(name, f)
    t.pass(`${f} again open ok`)
    t.equal(typeof fd, 'number', `${f} fd num`)
    t.ok(fd >= 0, `${f} fd ${fd} >= 0`)

    fs.accessSync(name)
    t.pass(`${f} again access ok`)

    stat = fs.fstatSync(fd)
    t.pass(`${f} again stat ok`)
    ino = stat.ino
    t.equal(typeof ino, 'number', `${f} ino num`)
    t.ok(ino >= 0, `${f} ino ${ino} >= 0`)
    t.equal(stat.uid, UID, `${f} uid`)
    t.equal(stat.gid, GID, `${f} gid`)
    // t.equal(perms(stat.mode), mode[1], `${f} mode`)

    arr = fs.readdirSync(DIR, { withFileTypes: true })
    t.pass(`${f} again readdir ok`)
    t.equal(arr.length, 1, '1 entry')
    t.ok(arr[0].isFile(), '1 file')
    t.equal(arr[0].name, n, '1 name')

    fs.closeSync(fd)
    t.pass(`${f} close ok`)

    fs.accessSync(name)
    t.pass(`${f} access ok`)
  }

  for (const f of flags) {
    step(f, 0)
    step(f, 1)
  }

  t.end()
})

test('copy rename', (t) => {
  empty(DIR)

  const file1 = `${DIR}/file1`
  const file2 = `${DIR}/file2`

  try {
    fs.cpSync(file1, file2)
    t.fail(`no copy error`)
  } catch (err) {
    t.pass(`copy error`)
    t.equal(err.code, 'ENOENT', `copy error ENOENT`)
  }

  try {
    fs.renameSync(file1, file2)
    t.fail(`no rename error`)
  } catch (err) {
    t.pass(`rename error`)
    t.equal(err.code, 'ENOENT', `rename error ENOENT`)
  }

  const data1 = 'hihihi'
  fs.writeFileSync(file1, data1)
  t.pass(`write ok`)

  fs.cpSync(file1, file2)
  t.pass(`copy ok`)

  fs.accessSync(file1)
  t.pass(`access file1 ok`)

  fs.accessSync(file2)
  t.pass(`access file2 ok`)

  let stat = fs.statSync(file2)
  t.pass(`stat ok`)
  const ino2 = stat.ino
  t.equal(typeof ino2, 'number', `ino num`)
  t.ok(ino2 >= 0, `ino ${ino2} >= 0`)

  const data2 = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read file2 ok`)
  t.equal(data2, data1, `data match`)

  let arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 2, '2 entry')

  const file3 = `${DIR}/file3`
  fs.renameSync(file2, file3)
  t.pass(`rename ok`)

  try {
    fs.accessSync(file2)
    t.fail(`no access error`)
  } catch (err) {
    t.pass(`access error`)
    t.equal(err.code, 'ENOENT', `access error ENOENT`)
  }

  fs.accessSync(file3)
  t.pass(`access file3 ok`)

  stat = fs.statSync(file3)
  t.pass(`stat ok`)
  const ino3 = stat.ino
  t.equal(typeof ino3, 'number', `ino num`)
  t.ok(ino3 >= 0, `ino ${ino3} >= 0`)
  t.equal(ino3, ino2, `ino3 = ino2`)

  const data3 = fs.readFileSync(file3, { encoding: 'utf8' })
  t.pass(`read file3 ok`)
  t.equal(data3, data2, `data match`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 2, '2 entry')

  fs.unlinkSync(file1)
  t.pass(`unlink ok`)

  arr = fs.readdirSync(DIR, { withFileTypes: true })
  t.pass(`readdir ok`)
  t.equal(arr.length, 1, '1 entry')
  t.ok(arr[0].isFile(), '1 file')
  t.equal(arr[0].name, 'file3', '1 name')

  t.end()
})

test('rename replace', (t) => {
  empty(DIR)

  const file1 = `${DIR}/file1`
  const file2 = `${DIR}/file2`

  const str1 = 'hihihi'
  fs.writeFileSync(file1, str1)
  t.pass(`write ok`)

  const str2 = 'hellohello'
  fs.writeFileSync(file2, str2)
  t.pass(`write ok`)

  let data = fs.readFileSync(file1, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str1, `data match`)

  data = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str2, `data match`)

  fs.renameSync(file1, file2)
  t.pass(`rename ok`)

  data = fs.readFileSync(file2, { encoding: 'utf8' })
  t.pass(`read ok`)
  t.equal(data, str1, `data match`)

  t.end()
})
