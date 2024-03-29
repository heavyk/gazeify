var through = require('through2')
var path = require('path')
var gaze = require('gaze')
var xtend = require('xtend')
var minimatch = require('minimatch')

module.exports = gazeify
module.exports.args = {
  cache: {}, packageCache: {}
}

function gazeify (b, opts) {
  if (!opts) opts = {}
  var cache = b._options.cache
  var pkgcache = b._options.packageCache
  var delay = typeof opts.delay === 'number' ? opts.delay : 600
  var changingDeps = {}
  var pending = false

  var wopts = {persistent: true}
  if (opts.ignoreWatch) {
    wopts.ignored = opts.ignoreWatch !== true
      ? opts.ignoreWatch
      : '**/node_modules/**'
  }
  if (opts.poll || typeof opts.poll === 'number') {
    wopts.mode = 'poll'
    if (opts.poll !== true)
      wopts.interval = opts.poll
  }

  if (cache) {
    b.on('reset', collect)
    collect()
  }

  function collect () {
    b.pipeline.get('deps').push(through.obj(function (row, enc, next) {
      var file = row.expose ? b._expose[row.id] : row.file
      cache[file] = {
        source: row.source,
        deps: xtend({}, row.deps)
      }
      this.push(row)
      next()
    }))
  }

  b.on('file', function (file) {
    watchFile(file)
  })

  b.on('package', function (pkg) {
    var file = path.join(pkg.__dirname, 'package.json')
    watchFile(file)
    if (pkgcache) pkgcache[file] = pkg
  })

  b.on('reset', reset)
  reset()

  function reset () {
    var time = null
    var bytes = 0
    b.pipeline.get('record').on('end', function () {
      time = Date.now()
    })

    b.pipeline.get('wrap').push(through(write, end))
    function write (buf, enc, next) {
      bytes += buf.length
      this.push(buf)
      next()
    }
    function end () {
      var delta = Date.now() - time
      b.emit('time', delta)
      b.emit('bytes', bytes)
      b.emit('log', bytes + ' bytes written ('
        + (delta / 1000).toFixed(2) + ' seconds)'
      )
      this.push(null)
    }
  }

  var fwatchers = {}
  var fwatcherFiles = {}

  b.on('transform', function (tr, mfile) {
    tr.on('file', function (dep) {
      watchFile(mfile, dep)
    })
  })

  function watchFile (file, dep) {
    dep = dep || file
    if (wopts.ignored && minimatch(dep, wopts.ignored)) return
    if (!fwatchers[file]) fwatchers[file] = []
    if (!fwatcherFiles[file]) fwatcherFiles[file] = []
    if (fwatcherFiles[file].indexOf(dep) >= 0) return

    var w = b._watcher(dep, wopts)
    w.setMaxListeners(0)
    w.on('error', b.emit.bind(b, 'error'))
    w.on('all', function () {
      invalidate(file)
    })
    fwatchers[file].push(w)
    fwatcherFiles[file].push(dep)
  }

  function invalidate (id) {
    if (cache) delete cache[id]
    if (pkgcache) delete pkgcache[id]
    if (fwatchers[id]) {
      fwatchers[id].forEach(function (w) {
        w.remove(id)
      })
      delete fwatchers[id]
      delete fwatcherFiles[id]
    }
    changingDeps[id] = true

    // wait for the disk/editor to quiet down first:
    if (!pending) setTimeout(function () {
        pending = false
        b.emit('update', Object.keys(changingDeps))
        changingDeps = {}
      }, delay)
    pending = true
  }

  b.close = function () {
    Object.keys(fwatchers).forEach(function (id) {
      fwatchers[id].forEach(function (w) { w.close() })
    })
  }

  b._watcher = function (file, opts) {
    return gaze(file, opts)
  }

  return b
}
