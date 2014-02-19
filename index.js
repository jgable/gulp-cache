'use strict';

var _ = require('lodash-node'),
    map = require('map-stream'),
    PluginError = require('gulp-util').PluginError,
    Cache = require('cache-swap'),
    TaskProxy = require('./lib/TaskProxy');

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
    success: true,
    value: 'contents'
};

var cacheTask = function (task, opts) {
    var self = this;

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
