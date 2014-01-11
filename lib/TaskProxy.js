'use strict';

var crypto = require('crypto'),
    _ = require('lodash-node'),
    PluginError = require('gulp-util').PluginError;

var TaskProxy = function (opts) {
    _.extend(this, _.pick(opts, 'file', 'name', 'opts'));
};

_.extend(TaskProxy.prototype, {
    processFile: function (cb) {
        // TODO: Break up this pyramid of callbacks with promises

        var self = this;

        this._getFileKey(function (err, key) {
            if (err) { 
                return cb(new PluginError('gulp-cache', err, 'Error getting file cache key for ' + self.name));
            }

            self._checkForCachedValue(key, function (err, cachedValue) {
                if (err) {
                    return cb(new PluginError('gulp-cache', err, 'Error checking cache for ' + self.name));
                }

                if (cachedValue) {
                    // Extend the cached value onto the file
                    _.extend(self.file, cachedValue);

                    // Continue to next task
                    return cb(null, self.file);
                }

                // Run the proxied task
                self._runProxiedTask(function (err, result) {
                    if (err) {
                        return cb(new PluginError('gulp-cache', err, 'Error running proxied task ' + self.name));
                    }
                    
                    // If this wasn't a success, continue to next task
                    // TODO: Should this also offer an async option?
                    if (!self.opts.success(result)) {
                        return cb(null, self.file);
                    }

                    // Grab the value from the options
                    self._getValueFromResult(result, function (err, value) {
                        if (err) {
                            return cb(new PluginError('gulp-cache', err, {showStack: true}));
                        }
                        
                        // Store the cached value
                        self._storeCachedValue(key, value, function (err) {
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

    _getFileKey: function (cb) {
        function makeHash(key) {
            return crypto.createHash('md5').update(key).digest('hex');
        }

        // Check for a callback expected
        if (this.opts.key.length === 2) {
            return this.opts.key(this.file, function (err, key) {
                if (err) {
                    return cb(err);
                }

                cb(null, makeHash(key));
            });
        }

        cb(null, makeHash(this.opts.key(this.file)));
    },

    _checkForCachedValue: function (key, cb) {
        this.opts.fileCache.getCached(this.name, key, function (err, cached) {
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

    _runProxiedTask: function (cb) {
        // Wait for data
        // TODO: Can tasks emit multiple data?
        this.opts.task.once('data', function (datum) {
            cb(null, datum);
        });

        this.opts.task.once('error', function (err) {
            cb(err);
        });

        // Run through the other task and grab output (or error)
        this.opts.task.write(this.file);
    },

    _getValueFromResult: function (result, cb) {
        if (this.opts.value.length === 2) {
            return this.opts.value(result, cb);
        }

        return cb(null, this.opts.value(result));
    },

    _storeCachedValue: function (key, value, cb) {
        var val = value;
        
        if (!_.isString(value)) {
            val = JSON.stringify(value, null, 2);
        }

        this.opts.fileCache.addCached(this.name, key, val, cb);
    }
});

module.exports = TaskProxy;

