'use strict';

var Cache = require('cache-swap'),
    File = require('vinyl'),
    objectAssign = require('object-assign'),
    objectOmit = require('object.omit'),
    PluginError = require('gulp-util').PluginError,
    through = require('through2'),
    TaskProxy = require('./lib/TaskProxy'),
    pkg = require('./package.json');

var fileCache = new Cache({
    cacheDirName: 'gulp-cache'
});

function defaultKey (file) {
    return [pkg.version, file.contents.toString('base64')].join('');
}

var defaultOptions = {
    fileCache: fileCache,
    name: 'default',
    key: defaultKey,
    restore: function (restored) {
        if (restored.contents) {
            // Handle node 0.11 buffer to JSON as object with { type: 'buffer', data: [...] }
            if (restored && restored.contents && Array.isArray(restored.contents.data)) {
                restored.contents = new Buffer(restored.contents.data);
            } else if (Array.isArray(restored.contents)) {
                restored.contents = new Buffer(restored.contents);
            } else if (typeof restored.contents === 'string') {
                restored.contents = new Buffer(restored.contents, 'base64');
            }
        }

        var restoredFile = new File(restored),
            extraTaskProperties = objectOmit(restored, Object.keys(restoredFile));

        // Restore any properties that the original task put on the file;
        // but omit the normal properties of the file
        return objectAssign(restoredFile, extraTaskProperties);
    },
    success: true,
    value: function (file) {
        // Convert from a File object (from vinyl) into a plain object
        return ['cwd', 'base', 'contents', 'stat', 'history'].reduce(function(obj, propName) {
          obj[propName] = file[propName];
          return obj;
        }, {});
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
        opts = objectAssign({}, task.cacheable, opts);
    }

    // Make sure we have some sane defaults
    opts = objectAssign({}, cacheTask.defaultOptions, opts);

    return through.obj(function (file, enc, cb) {
        if (file.isNull()) {
            cb(null, file);
            return;
        }

        // Indicate clearly that we do not support Streams
        if (file.isStream()) {
            cb(new PluginError('gulp-cache', 'Cannot operate on stream sources'));
            return;
        }

        // Create a TaskProxy object and start up processFile().

        var taskProxy = new TaskProxy({
            task: task,
            file: file,
            opts: opts
        });

        taskProxy.processFile().then(function (result) {
            cb(null, result);
        }, function (err) {
            cb(new PluginError('gulp-cache', err));
        });
    });
};

cacheTask.clear = function (opts) {
    opts = objectAssign({}, cacheTask.defaultOptions, opts);

    return through.obj(function (file, enc, cb) {
        if (file.isNull()) {
            cb(null, file);
            return;
        }

        // Indicate clearly that we do not support Streams
        if (file.isStream()) {
            cb(new PluginError('gulp-cache', 'Cannot operate on stream sources'));
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
    fileCache.clear(null, function (err) {
        if (err) {
            throw new PluginError('gulp-cache', 'Problem clearing the cache: ' + err.message);
        }

        if (done) {
          done();
        }
    });
};

cacheTask.fileCache = fileCache;
cacheTask.defaultOptions = defaultOptions;
cacheTask.Cache = Cache;

module.exports = cacheTask;
