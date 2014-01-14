'use strict';

var PassThrough = require('stream').PassThrough,
    _ = require('lodash-node'),
    should = require('should'),
    sinon = require('sinon'),
    map = require('map-stream'),
    gutil = require('gulp-util');

var cache = require('../index');

require('mocha');

describe('gulp-cache', function () {
    var fakeFileHandler,
        fakeTask;

    beforeEach(function (done) {
        // Spy on the fakeFileHandler to check if it gets called later
        fakeFileHandler = sinon.spy(function (file, cb) {
            file.ran = true;
            
            cb(null, file);
        }),
        fakeTask = map(fakeFileHandler);

        cache.fileCache.clear('default', done);
    });

    it('throws an error if no task is passed', function () {
        var shouldThrow = function () {
            var proxied = cache();
        };

        shouldThrow.should.throw();
    });

    describe('in streaming mode', function () {
        it('can proxy a task', function (done) {
            // create the fake file
            var fakeStream = new PassThrough(),
                fakeFile = new gutil.File({
                    contents: fakeStream
                });

            // Create a proxied plugin stream
            var proxied = cache(fakeTask, {
                key: function (file, cb) {
                    // For testing async key generation
                    setTimeout(function () {
                        cb(null, '123');
                    }, 1);
                },
                value: function (file, cb) {
                    // For testing async value generation
                    setTimeout(function () {
                        cb(null, {
                            ran: file.ran,
                            cached: true
                        });
                    }, 1);
                }
            });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {

                // make sure it came out the same way it went in
                file.isStream().should.equal(true);
                
                // Check it assigned the proxied task result
                file.ran.should.equal(true);
                should.not.exist(file.cached);

                // Check the original task was called
                fakeFileHandler.called.should.equal(true);

                // Reset for the second run through
                fakeFileHandler.reset();

                // Write the same file again, should be cached result
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // make sure it came out the same way it went in
                    secondFile.isStream().should.equal(true);

                    // Cached value should have been applied
                    secondFile.ran.should.equal(true);
                    secondFile.cached.should.equal(true);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    done();
                });
            });
        });

        it('cannot set a default key for files', function (done) {
            // create the fake file
            var fakeStream = new PassThrough(),
                fakeFile = new gutil.File({
                    contents: fakeStream
                });

            // Create a proxied plugin stream
            var proxied = cache(fakeTask, {
                value: function (file, cb) {
                    // For testing async value generation
                    setTimeout(function () {
                        cb(null, {
                            ran: file.ran,
                            cached: true
                        });
                    }, 1);
                }
            });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {

                // Check it assigned the proxied task result
                file.ran.should.equal(true);
                should.not.exist(file.cached);

                // Check the original task was called
                fakeFileHandler.called.should.equal(true);

                // Reset for the second run through
                fakeFileHandler.reset();

                // Write the same file again
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // Cached value should not have been applied
                    secondFile.ran.should.equal(true);
                    should.not.exist(secondFile.cached);

                    // Should have called the original task
                    fakeFileHandler.called.should.equal(true);

                    done();
                });
            });
        });
    });

    describe('in buffered mode', function () {
        it('only caches successful tasks', function (done) {
            // create the fake file
            var fakeFile = new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Create a proxied plugin stream
            var valStub = sinon.stub().returns({
                    ran: true,
                    cached: true
                }),
                proxied = cache(fakeTask, {
                    success: function () {
                        return false;
                    },
                    value: valStub
                });

            proxied.write(fakeFile);

            proxied.once('data', function (file) {
                valStub.called.should.equal(false);

                done();
            });
        });

        it('can proxy a task with specific options', function (done) {
            // create the fake file
            var fakeFile = new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Create a proxied plugin stream
            var proxied = cache(fakeTask, {
                value: function (file) {
                    return {
                        ran: file.ran,
                        cached: true
                    };
                }
            });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {
                // make sure it came out the same way it went in
                file.isBuffer().should.equal(true);

                // check the contents are same
                file.contents.toString('utf8').should.equal('abufferwiththiscontent');

                // Check it assigned the proxied task result
                file.ran.should.equal(true);
                should.not.exist(file.cached);

                // Check the original task was called
                fakeFileHandler.called.should.equal(true);

                // Reset for the second run through
                fakeFileHandler.reset();

                // Write the same file again, should be cached result
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // make sure it came out the same way it went in
                    secondFile.isBuffer().should.equal(true);

                    // check the contents are same
                    secondFile.contents.toString('utf8').should.equal('abufferwiththiscontent');

                    // Cached value should have been applied
                    secondFile.ran.should.equal(true);
                    secondFile.cached.should.equal(true);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    done();
                });
            });
        });

        it('can proxy a task using task.cacheable', function (done) {
            // create the fake file
            var fakeFile = new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Let the task define the cacheable aspects.
            fakeTask.cacheable = {
                key: sinon.spy(function (file) {
                    return file.contents.toString('utf8');
                }),
                success: sinon.stub().returns(true),
                value: sinon.stub().returns({
                    ran: true,
                    cached: true
                })
            };

            var proxied = cache(fakeTask);

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {
                // make sure it came out the same way it went in
                file.isBuffer().should.equal(true);

                // check the contents are same
                file.contents.toString('utf8').should.equal('abufferwiththiscontent');

                // Verify the cacheable options were used.
                fakeTask.cacheable.key.called.should.equal(true);
                fakeTask.cacheable.success.called.should.equal(true);
                fakeTask.cacheable.value.called.should.equal(true);

                _.invoke([
                        fakeTask.cacheable.key, 
                        fakeTask.cacheable.success, 
                        fakeTask.cacheable.value,
                        fakeFileHandler
                    ], 'reset');

                // Write the same file again, should be cached result
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // Cached value should have been applied
                    secondFile.cached.should.equal(true);

                    fakeTask.cacheable.key.called.should.equal(true);
                    fakeTask.cacheable.success.called.should.equal(false);
                    fakeTask.cacheable.value.called.should.equal(false);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    done();
                });
            });
        });

        it('can proxy a task using task.cacheable with user overrides', function (done) {
            // create the fake file
            var fakeFile = new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Let the task define the cacheable aspects.
            fakeTask.cacheable = {
                key: sinon.spy(function (file) {
                    return file.contents.toString('utf8');
                }),
                success: sinon.stub().returns(true),
                value: sinon.stub().returns({
                    ran: true,
                    cached: true
                })
            };

            var overriddenValue = sinon.stub().returns({
                    ran: true,
                    cached: true,
                    overridden: true
                }),
                proxied = cache(fakeTask, {
                    value: overriddenValue
                });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {
                // make sure it came out the same way it went in
                file.isBuffer().should.equal(true);

                // check the contents are same
                file.contents.toString('utf8').should.equal('abufferwiththiscontent');

                // Verify the cacheable options were used.
                fakeTask.cacheable.key.called.should.equal(true);
                fakeTask.cacheable.success.called.should.equal(true);
                fakeTask.cacheable.value.called.should.equal(false);
                overriddenValue.called.should.equal(true);

                _.invoke([
                        fakeTask.cacheable.key, 
                        fakeTask.cacheable.success, 
                        fakeTask.cacheable.value,
                        overriddenValue,
                        fakeFileHandler
                    ], 'reset');

                // Write the same file again, should be cached result
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // Cached value should have been applied
                    secondFile.cached.should.equal(true);
                    secondFile.overridden.should.equal(true);

                    fakeTask.cacheable.key.called.should.equal(true);
                    fakeTask.cacheable.success.called.should.equal(false);
                    fakeTask.cacheable.value.called.should.equal(false);
                    overriddenValue.called.should.equal(false);

                    // Should not have called the original task
                    fakeFileHandler.called.should.equal(false);

                    done();
                });
            });
        });

        it('can be passed just a string for the value', function (done) {
            // create the fake file
            var fakeFile = new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                });

            // Create a proxied plugin stream
            var proxied = cache(fakeTask, {
                value: 'ran'
            });

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {
                // Check it assigned the proxied task result
                file.ran.should.equal(true);

                // Write the same file again, should be cached result
                proxied.write(fakeFile);

                proxied.once('data', function (secondFile) {
                    // Cached value should have been applied
                    secondFile.ran.should.equal(true);

                    done();
                });
            });
        });

        it('can store changed contents of files', function (done) {
            // create the fake file
            var fakeFile = new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                }),
                updatedFileHandler = sinon.spy(function (file, cb) {
                    file.contents = new Buffer('updatedcontent');

                    cb(null, file);
                });

            fakeTask = map(updatedFileHandler);

            // Create a proxied plugin stream
            var proxied = cache(fakeTask);

            // write the fake file to it
            proxied.write(fakeFile);

            // wait for the file to come back out
            proxied.once('data', function (file) {
                // Check for updated content
                file.contents.toString().should.equal('updatedcontent');

                // Check original handler was called
                updatedFileHandler.called.should.equal(true);

                updatedFileHandler.reset();

                // Write the same file again, should be cached result
                proxied.write(new gutil.File({
                    contents: new Buffer('abufferwiththiscontent')
                }));

                proxied.once('data', function (secondFile) {
                    // Check for updated content
                    file.contents.toString().should.equal('updatedcontent');

                    // Check original handler was not called.
                    updatedFileHandler.called.should.equal(false);

                    done();
                });
            });
        });
    });
});