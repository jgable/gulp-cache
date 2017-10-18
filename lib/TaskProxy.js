'use strict';

var crypto = require('crypto');

var File = require('vinyl');
var objectAssign = require('object-assign');
var objectPick = require('object.pick');
var Bluebird = require('bluebird');
var tryJsonParse = require('try-json-parse');

var TaskProxy = function(opts) {
  objectAssign(this, {
    task: opts.task,
    file: opts.file,
    opts: opts.opts,
    originalPath: opts.file.path,
    originalBase: opts.file.base
  });
};

TaskProxy.injectDoneEvent = function(task) {
  if (typeof task._flush !== 'undefined') {
    var _flush = task._flush;

    task._flush = function(callback) {
      var self = this;

      _flush.call(function() {
        callback.apply(undefined, arguments);
        self.emit('gulp-cache:done');
      });
    };
  } else {
    var _transform = task._transform;

    task._transform = function(chunk, encoding, callback) {
      var self = this;

      _transform.call(this, chunk, encoding, function() {
        callback.apply(undefined, arguments);
        self.emit('gulp-cache:done');
      });
    };
  }
};

function makeHash(key) {
  return crypto.createHash('md5').update(key).digest('hex');
}

objectAssign(TaskProxy.prototype, {
  processFile: function() {
    var self = this;

    return this._checkForCachedValue().then(function(cached) {
      // If we found a cached value
      // The path of the cache key should also be identical to the original one when the file path changed inside the task
      var cachedValue = cached.value;
      var cachedValueNotEmpty = Array.isArray(cachedValue) && cachedValue.length;
      var cachedValueHasNormalPaths = cachedValueNotEmpty && cachedValue.every(function(file) {
        return (!file.filePathChangedInsideTask || file.originalPath === self.file.path) &&
          (!file.fileBaseChangedInsideTask || file.originalBase === self.file.base);
      });

      if (cachedValueHasNormalPaths) {
        var files = cachedValue.map(function(cachedFile) {
          // Extend the cached value onto the file, but don't overwrite original path info
          var file = new File(objectAssign(
            {},
            // custom properties
            cachedFile,
            // file info
            objectPick(self.file, ['cwd', 'base', 'stat', 'history', 'path']),
            // file contents
            {contents: cachedFile.contents}
          ));
          // Restore the file path if it was set
          if (cachedFile.path && cachedFile.filePathChangedInsideTask) {
            file.path = cachedFile.path;
          }
          // Restore the file base if it was set
          if (cachedFile.base && cachedFile.fileBaseChangedInsideTask) {
            file.base = cachedFile.base;
          }
          return file;
        });
        return files;
      }

      // Otherwise, run the proxied task
      return self._runProxiedTaskAndCache(cached.key);
    });
  },

  removeCachedResult: function() {
    var self = this;

    return this._getFileKey().then(function(cachedKey) {
      var removeCached = Bluebird.promisify(self.opts.fileCache.removeCached, {
        context: self.opts.fileCache
      });

      return removeCached(self.opts.name, cachedKey);
    });
  },

  _getFileKey: function() {
    var getKey = this.opts.key;

    if (typeof getKey === 'function' && getKey.length === 2) {
      getKey = Bluebird.promisify(getKey.bind(this.opts));
    }

    return Bluebird.resolve(getKey(this.file)).then(function(key) {
      if (!key) {
        return key;
      }

      return makeHash(key);
    });
  },

  _checkForCachedValue: function() {
    var self = this;

    return this._getFileKey().then(function(key) {
      // If no key returned, bug out early
      if (!key) {
        return {
          key: key,
          value: null
        };
      }

      var getCached = Bluebird.promisify(self.opts.fileCache.getCached.bind(self.opts.fileCache));

      return getCached(self.opts.name, key).then(function(cached) {
        if (!cached) {
          return {
            key: key,
            value: null
          };
        }

        var parsedContents = tryJsonParse(cached.contents);
        if (parsedContents === undefined) {
          parsedContents = {cached: cached.contents};
        }

        if (self.opts.restore) {
          parsedContents = parsedContents.map(function(parsedFile) {
            return self.opts.restore(parsedFile);
          });
        }

        return {
          key: key,
          value: parsedContents
        };
      });
    });
  },

  _runProxiedTaskAndCache: function(cachedKey) {
    var self = this;

    return self._runProxiedTask(cachedKey).then(function(result) {
      // If this wasn't a success, continue to next task
      // TODO: Should this also offer an async option?
      if (self.opts.success !== true && !result.every(self.opts.success.bind(self.opts))) {
        return result;
      }

      return self._storeCachedResult(cachedKey, result).then(function() {
        return result;
      });
    });
  },

  _runProxiedTask: function(cachedKey) {
    var self = this;

    /* eslint no-use-before-define: 0 */
    return new Bluebird(function(resolve, reject) {
      var data = [];

      function handleError(err) {
        // TODO: Errors will step on each other here
        // Be good citizens and remove our listeners
        self.task.removeListener('error', handleError);
        self.task.removeListener('gulp-cache:done', handleData);
        self.task.removeListener('data', collectData);

        // Reduce the maxListeners back down
        self.task.setMaxListeners(self.task._maxListeners - 3);

        reject(err);
      }

      function collectData(datum) {
        // Wait for data (can be out of order, so check for matching file we wrote)
        if (self.file !== datum && self.file._cachedKey !== cachedKey) {
          return;
        }

        data.push(datum);
      }

      function handleData() {
        // Be good citizens and remove our listeners
        self.task.removeListener('error', handleError);
        self.task.removeListener('gulp-cache:done', handleData);
        self.task.removeListener('data', collectData);

        // Reduce the maxListeners back down
        self.task.setMaxListeners(self.task._maxListeners - 3);

        resolve(data);
      }

      // Bump up max listeners to prevent memory leak warnings
      var currMaxListeners = self.task._maxListeners || 0;
      self.task.setMaxListeners(currMaxListeners + 3);

      self.task.on('data', collectData);
      self.task.once('gulp-cache:done', handleData);
      self.task.once('error', handleError);

      self.file._cachedKey = cachedKey;

      // Run through the other task and grab output (or error)
      // Not sure if a _.defer is necessary here
      self.task.write(self.file);
    });
  },

  _getValueFromResult: function(result) {
    var getValue;

    if (typeof this.opts.value !== 'function') {
      if (typeof this.opts.value === 'string') {
        getValue = {};
        getValue[this.opts.value] = result[this.opts.value];
      }

      return Bluebird.resolve(getValue);
    } else if (this.opts.value.length === 2) {
      // Promisify if passed a node style function
      getValue = Bluebird.promisify(this.opts.value.bind(this.opts));
    } else {
      getValue = this.opts.value;
    }

    return Bluebird.resolve(getValue(result));
  },

  _storeCachedResult: function(key, result) {
    var self = this;

    // If we didn't have a cachedKey, skip caching result
    if (!key) {
      return Bluebird.resolve(result);
    }

    var addCached = Bluebird.promisify(self.opts.fileCache.addCached.bind(self.opts.fileCache));

    return Promise.all(result.map(function(file) {
      return self._getValueFromResult(file).then(function(value) {
        var val;

        if (typeof value !== 'string') {
          if (value && typeof value === 'object' && Buffer.isBuffer(value.contents)) {
            // Shallow copy so "contents" can be safely modified
            val = objectAssign({}, value);
            val.contents = val.contents.toString('utf8');
          }

          // Check if the task changed the file path
          if (value.path !== self.originalPath) {
            value.filePathChangedInsideTask = true;
          }
          // Check if the task changed the base path
          if (value.base !== self.originalBase) {
            value.fileBaseChangedInsideTask = true;
          }

          // Keep track of the original path
          value.originalPath = self.originalPath;
          // Keep track of the original base
          value.originalBase = self.originalBase;
          val = value;
        } else {
          val = value;
        }

        return val;
      });
    })).then(function(values) {
      return addCached(self.opts.name, key, JSON.stringify(values, null, 2));
    });
  }
});

module.exports = TaskProxy;
