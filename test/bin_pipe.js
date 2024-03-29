var test = require('tape')
var fs = require('fs')
var path = require('path')
var mkdirp = require('mkdirp')
var spawn = require('win-spawn')
var split = require('split')

var cmd = path.resolve(__dirname, '../bin/cmd.js')
var os = require('os')
var tmpdir = path.join((os.tmpdir || os.tmpDir)(), 'gazeify-' + Math.random())

var files = {
  main: path.join(tmpdir, 'main.js'),
  bundle: path.join(tmpdir, 'bundle.js')
}

mkdirp.sync(tmpdir)
fs.writeFileSync(files.main, 'console.log(9+9+555)')

test('bin with pipe', function (t) {
  if (process.platform === 'win32') {
    t.skip('not for windows')
    t.end()
    return
  }
  t.plan(4)
  var ps = spawn(cmd, [
    files.main,
    '-o', 'sed "s/9+9+//" > ' + files.bundle,
    '-v'
  ])
  var lineNum = 0
  ps.stderr.pipe(split()).on('data', function (line) {
    lineNum++
    if (lineNum === 1) {
      run(files.bundle, function (err, output) {
        t.ifError(err)
        t.equal(output, '555\n')
        fs.writeFile(files.main, 'console.log(9+9+333)')
      })
    } else if (lineNum === 2) {
      run(files.bundle, function (err, output) {
        t.ifError(err)
        t.equal(output, '333\n')
        ps.kill()
      })
    }
  })
})

function run (file, cb) {
  var ps = spawn(process.execPath, [ file ])
  var data = []
  ps.stdout.on('data', function (buf) { data.push(buf) })
  ps.stdout.on('end', function () {
    cb(null, Buffer.concat(data).toString('utf8'))
  })
  ps.on('error', cb)
  return ps
}
