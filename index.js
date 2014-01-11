'use strict';

var _ = require('lodash-node'),
    es = require('event-stream'),
    PluginError = require('gulp-util').PluginError,
    Cache = require('cache-swap'),
    TaskProxy = require('./lib/TaskProxy');

var fileCache = new Cache({
    cacheDirName: 'gulp-cache'
});

var defaultOptions = {
    fileCache: fileCache,
    key: _.noop,
    success: _.noop,
    value: _.noop
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
            var taskProxy = new TaskProxy({
                name: name,
                file: file,
                opts: opts
            });

            return taskProxy.processFile(cb);
        });
    }
};

cacheTask.fileCache = fileCache;

module.exports = cacheTask;