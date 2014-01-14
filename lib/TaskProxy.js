'use strict';

var crypto = require('crypto'),
    _ = require('lodash-node'),
    Promise = require('bluebird'),
    PluginError = require('gulp-util').PluginError;

var TaskProxy = function (opts) {
    _.extend(this, _.pick(opts, 'task', 'file', 'opts'));
};

_.extend(TaskProxy.prototype, {
    processFile: function () {
        var self = this;

        return this._checkForCachedValue().then(function (cached) {
            // If we found a cached value
            if (cached.value) {
                // Extend the cached value onto the file
                _.extend(self.file, cached.value);

                return self.file;
            }

            // Otherwise, run the proxied task
            return self._runProxiedTaskAndCache(cached.key);
        });
    },

    _getFileKey: function () {
        function makeHash(key) {
            return crypto.createHash('md5').update(key).digest('hex');
        }

        var getKey = this.opts.key,
            def;

        if (_.isFunction(getKey) && getKey.length === 2) {
            getKey = Promise.promisify(getKey, this.opts);
        }

        return Promise.resolve(getKey(this.file)).then(function (key) {
            if (!key) {
                return key;
            }

            return makeHash(key);
        });
    },

    _checkForCachedValue: function (key) {
        var self = this;

        return this._getFileKey().then(function (key) {
            // If no key returned, bug out early
            if (!key) {
                return {
                    key: key,
                    value: null
                };
            }

            var getCached = Promise.promisify(self.opts.fileCache.getCached, self.opts.fileCache);

            return getCached(self.opts.name, key).then(function (cached) {
                if (!cached) {
                    return {
                        key: key,
                        value: null
                    };
                }

                var parsedContents;

                try {
                    parsedContents = JSON.parse(cached.contents);
                } catch (e) {
                    parsedContents = { cached: cached.contents };
                }

                // Vinyl will only allow setting the contents to a buffer or stream
                if (parsedContents.contents) {
                    parsedContents.contents = new Buffer(parsedContents.contents);
                }

                return {
                    key: key,
                    value: parsedContents
                };
            });
        });
    },

    _runProxiedTaskAndCache: function (cachedKey) {
        var self = this;

        return self._runProxiedTask().then(function (result) {
            // If this wasn't a success, continue to next task
            // TODO: Should this also offer an async option?
            if (self.opts.success !== true && !self.opts.success(result)) {
                return result;
            }

            return self._storeCachedResult(cachedKey, result).then(function () {
                return result;
            });
        });
    },

    _runProxiedTask: function () {
        var self = this,
            def = Promise.defer();

        // Wait for data
        // TODO: Can tasks emit multiple data?
        this.task.once('data', function (datum) {
            def.resolve(datum);
        });

        this.task.once('error', function (err) {
            def.reject(err);
        });

        // Run through the other task and grab output (or error)
        // Not sure if a _.defer is necessary here
        self.task.write(self.file);
        
        return def.promise;
    },

    _getValueFromResult: function (result) {
        var def;

        var getValue = this.opts.value;

        if (!_.isFunction(getValue)) {
            if (_.isString(getValue)) {
                getValue = _.pick(result, getValue);
            }

            return Promise.resolve(getValue);
        } else if (getValue.length === 2) {
            // Promisify if passed a node style function
            getValue = Promise.promisify(getValue, this.opts);
        }

        return Promise.resolve(getValue(result));
    },

    _storeCachedResult: function (key, result) {
        var self = this;

        // If we didn't have a cachedKey, skip caching result
        if (!key) {
            return Promise.resolve(result);
        }

        return this._getValueFromResult(result).then(function (value) {
            var val = value,
                addCached = Promise.promisify(self.opts.fileCache.addCached, self.opts.fileCache);
        
            if (!_.isString(value)) {
                val = JSON.stringify(value, null, 2);
            }

            return addCached(self.opts.name, key, val);
        });
    }
});

module.exports = TaskProxy;

