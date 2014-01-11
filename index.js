'use strict';

var fs = require('fs'),
    crypto = require('crypto'),
    _ = require('lodash-node'),
    es = require('event-stream'),
    gulpUtil = require('gulp-util'),
    PluginError = gulpUtil.PluginError,
    Cache = require('cache-swap');

var fileCache = new Cache({
    cacheDirName: 'gulp-cache'
});

// For brevity
var noop = function (cb) {
    if (cb) {
        cb();
    }
};

var defaultOptions = {
    fileCache: fileCache,
    key: noop,
    success: noop,
    value: noop
};

var cacheTask = {
    proxy: function (name, opts) {
        var self = this;

        // Make sure we have some sane defaults
        opts = _.defaults(opts || {}, defaultOptions);
        
        // Check for required task option
        if (!opts.task) {
            throw new PluginError('gulp-cache', 'Must pass a task to ' + name + ' cache.proxy');
        }

        // Pass through the file and cb to _processFile along with the opts
        return es.map(function (file, cb) {
            return self._processFile(name, file, opts, cb);
        });
    },

    _processFile: function (name, file, opts, cb) {
        // TODO: Make this and the _functions their own class (ProxyProcessor)
        var self = this;

        this._getFileKey(file, opts, function (err, key) {
            if (err) { 
                return cb(new PluginError('gulp-cache', err, 'Error getting file cache key for ' + name));
            }

            self._checkForCachedValue(name, key, opts, function (err, cachedValue) {
                if (err) {
                    return cb(new PluginError('gulp-cache', err, 'Error checking cache for ' + name));
                }

                if (cachedValue) {
                    // Extend the cached value onto the file
                    _.extend(file, cachedValue);

                    // Continue to next task
                    return cb(null, file);
                }

                // Run the proxied task
                self._runProxiedTask(file, opts, function (err, result) {
                    if (err) {
                        return cb(new PluginError('gulp-cache', err, 'Error running proxied task ' + name));
                    }
                    
                    // If this wasn't a success, continue to next task
                    // TODO: Should this also offer an async option?
                    if (!opts.success(result)) {
                        return cb(null, file);
                    }

                    // Grab the value from the options
                    self._getValueFromResult(result, opts, function (err, value) {
                        if (err) {
                            return cb(new PluginError('gulp-cache', err, {showStack: true}));
                        }
                        
                        // Store the cached value
                        self._storeCachedValue(name, key, value, opts, function (err) {
                            if (err) {
                                return cb(new PluginError('gulp-cache', err, { showStack: true }));
                            }
                            
                            cb(null, result);
                        });
                    });
                });
            });
        });
    },

    _getFileKey: function (file, opts, cb) {
        function makeHash(key) {
            return crypto.createHash('md5').update(key).digest('hex');
        }

        // Check for a callback expected
        if (opts.key.length === 2) {
            return opts.key(file, function (err, key) {
                if (err) {
                    return cb(err);
                }

                cb(null, makeHash(key));
            });
        }

        cb(null, makeHash(opts.key(file)));
    },

    _checkForCachedValue: function (name, key, opts, cb) {
        opts.fileCache.getCached(name, key, function (err, cached) {
            if (err) {
                return cb(err);
            }

            if (!cached) {
                return cb();
            }

            var parsedContents;

            try {
                parsedContents = JSON.parse(cached.contents);
            } catch (e) {
                parsedContents = { cached: cached.contents };
            }

            cb(null, parsedContents);
        });
    },

    _runProxiedTask: function (file, opts, cb) {
        // Wait for data
        // TODO: Can tasks emit multiple data?
        opts.task.once('data', function (datum) {
            cb(null, datum);
        });

        opts.task.once('error', function (err) {
            cb(err);
        });

        // Run through the other task and grab output (or error)
        opts.task.write(file);
    },

    _getValueFromResult: function (result, opts, cb) {
        if (opts.value.length === 2) {
            return opts.value(result, cb);
        }

        return cb(null, opts.value(result));
    },

    _storeCachedValue: function (name, key, value, opts, cb) {
        var val = value;
        
        if (!_.isString(value)) {
            val = JSON.stringify(value, null, 2);
        }

        opts.fileCache.addCached(name, key, val, cb);
    }
};

cacheTask.fileCache = fileCache;

module.exports = cacheTask;