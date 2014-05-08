'use strict';

var _ = require('lodash-node'),
    map = require('map-stream'),
    PluginError = require('gulp-util').PluginError,
    Cache = require('cache-swap'),
    TaskProxy = require('./lib/TaskProxy'),
    File = require('vinyl');

var fileCache = new Cache({
    cacheDirName: 'gulp-cache'
});

var defaultOptions = {
    fileCache: fileCache,
    name: 'default',
    key: function (file) {
        if (file.isBuffer()) {
            return file.contents.toString('utf8');
        }

        return undefined;
    },
    restore: function (restored) {
        if (restored.contents) {
            restored.contents = new Buffer(restored.contents, 'utf8');
        }

        return new File(restored);
    },
    success: true,
    value: function (file) {
        /* Convert from a File object (from vinyl) into a plain object so
         * we can change the contents to a string.  Using normal cloning
         * methods will copy the _contents property, which is not what we
         * want.
         */
        var copy = {
            cwd: file.cwd,
            base: file.base,
            path: file.path,
            stat: file.stat,
            contents: file.contents
        };

        if (Buffer.isBuffer(copy.contents)) {
            copy.contents = copy.contents.toString('utf8');
        }

        return copy;
    }
};

var cacheTask = function (task, opts) {
    // Check for required task option
    if (!task) {
        throw new PluginError('gulp-cache', 'Must pass a task to cache()');
    }

    // Check if this task participates in the cacheable contract
    if (task.cacheable) {
        // Use the cacheable options, but allow the user to override them
        opts = _.extend({}, task.cacheable, opts);
    }

    // Make sure we have some sane defaults
    opts = _.defaults(opts || {}, cacheTask.defaultOptions);

    return map(function (file, cb) {
        // Create a TaskProxy object and start up processFile().

        var taskProxy = new TaskProxy({
            task: task,
            file: file,
            opts: opts
        });

        taskProxy.processFile().then(function (result) {
            cb(null, result);
        }).catch(function (err) {
            cb(new PluginError('gulp-cache', err));
        });
    });
};

cacheTask.clear = function (opts) {
    opts = _.defaults(opts || {}, cacheTask.defaultOptions);

    return map(function (file, cb) {
        // Indicate clearly that we do not support Streams
        if (file.isStream()) {
            cb(new PluginError('gulp-cache', 'Can not operate on stream sources'));
            return;
        }

        var taskProxy = new TaskProxy({
            task: null,
            file: file,
            opts: opts
        });

        taskProxy.removeCachedResult().then(function () {
            cb(null, file);
        }).catch(function (err) {
            cb(new PluginError('gulp-cache', err));
        });
    });
};

cacheTask.clearAll = function (done) {
    done = done || _.noop;

    fileCache.clear(null, function (err) {
        if (err) {
            throw new PluginError('gulp-cache', 'Problem clearing the cache: ' + err.message);
        }

        done();
    });
};

cacheTask.fileCache = fileCache;
cacheTask.defaultOptions = defaultOptions;

module.exports = cacheTask;
